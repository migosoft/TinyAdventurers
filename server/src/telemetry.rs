//! Logging, and OpenTelemetry export of traces, logs and metrics.
//!
//! The console log is always on (`RUST_LOG`, default `info`). OTLP export
//! (HTTP/protobuf) starts only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, e.g.
//! `http://otel-collector:4318`; the exporter appends `/v1/traces`, `/v1/logs`
//! and `/v1/metrics` and honours the other standard `OTEL_*` variables
//! (`OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, per-signal endpoints,
//! headers). Without it, metric recording goes to a no-op meter.
//!
//! Attributes never carry player names: ids, classes, bosses and outcomes only.

use crate::lobby::SharedLobby;
use crate::run::RunRecord;
use opentelemetry::metrics::{Counter, Histogram, Meter, ObservableGauge, UpDownCounter};
use opentelemetry::trace::TracerProvider as _;
use opentelemetry::{global, KeyValue};
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::metrics::{PeriodicReader, SdkMeterProvider};
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;
use std::sync::OnceLock;
use std::time::Duration;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer};

pub const SERVICE_NAME: &str = "tiny-adventurers-server";
const METRIC_INTERVAL: Duration = Duration::from_secs(15);

/// The exporter's own HTTP client logs through `tracing` too; those events
/// must not be exported again (a feedback loop), so they are filtered out.
const OTEL_FILTER: &str = "info,hyper=off,hyper_util=off,reqwest=off,h2=off,tower=off,opentelemetry=off,opentelemetry_sdk=off,opentelemetry_otlp=off,opentelemetry_http=off";

/// Keeps the OTLP providers alive; `shutdown` flushes what is still buffered.
#[derive(Default)]
pub struct Guard {
    tracer: Option<SdkTracerProvider>,
    logger: Option<SdkLoggerProvider>,
    meter: Option<SdkMeterProvider>,
}

impl Guard {
    pub fn shutdown(self) {
        if let Some(t) = self.tracer {
            let _ = t.shutdown();
        }
        if let Some(m) = self.meter {
            let _ = m.shutdown();
        }
        if let Some(l) = self.logger {
            let _ = l.shutdown();
        }
    }
}

fn otlp_configured() -> bool {
    ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"]
        .iter()
        .any(|v| std::env::var(v).map_or(false, |s| !s.trim().is_empty()))
}

fn resource() -> Resource {
    let b = Resource::builder();
    // OTEL_SERVICE_NAME wins when set; the SDK default would be "unknown_service".
    if std::env::var("OTEL_SERVICE_NAME").map_or(true, |s| s.trim().is_empty()) {
        b.with_service_name(SERVICE_NAME).build()
    } else {
        b.build()
    }
}

/// Sets up the console log and, if configured, OTLP export. Call once, first
/// thing in `main`, from inside the tokio runtime.
pub fn init() -> Guard {
    let console = tracing_subscriber::fmt::layer().with_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")));
    if !otlp_configured() {
        tracing_subscriber::registry().with(console).init();
        return Guard::default();
    }
    match providers() {
        Ok(guard) => {
            let tracer = guard.tracer.as_ref().expect("tracer").tracer(SERVICE_NAME);
            let traces = tracing_opentelemetry::layer().with_tracer(tracer).with_filter(EnvFilter::new(OTEL_FILTER));
            let logs = opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge::new(guard.logger.as_ref().expect("logger")).with_filter(EnvFilter::new(OTEL_FILTER));
            tracing_subscriber::registry().with(console).with(traces).with(logs).init();
            tracing::info!("OpenTelemetry export on (traces, logs, metrics every {}s)", METRIC_INTERVAL.as_secs());
            guard
        }
        Err(e) => {
            tracing_subscriber::registry().with(console).init();
            tracing::error!("OpenTelemetry export off, the exporter could not be set up: {e}");
            Guard::default()
        }
    }
}

fn providers() -> Result<Guard, Box<dyn std::error::Error>> {
    let resource = resource();
    let spans = opentelemetry_otlp::SpanExporter::builder().with_http().build()?;
    let tracer = SdkTracerProvider::builder().with_resource(resource.clone()).with_batch_exporter(spans).build();
    let logs = opentelemetry_otlp::LogExporter::builder().with_http().build()?;
    let logger = SdkLoggerProvider::builder().with_resource(resource.clone()).with_batch_exporter(logs).build();
    let metrics = opentelemetry_otlp::MetricExporter::builder().with_http().build()?;
    let reader = PeriodicReader::builder(metrics).with_interval(METRIC_INTERVAL).build();
    let meter = SdkMeterProvider::builder().with_resource(resource).with_reader(reader).build();
    global::set_meter_provider(meter.clone());
    global::set_tracer_provider(tracer.clone());
    Ok(Guard { tracer: Some(tracer), logger: Some(logger), meter: Some(meter) })
}

// -------------------------------------------------------------------- metrics

/// The game's instruments. Recording is cheap and a no-op without export.
pub struct Metrics {
    logins: Counter<u64>,
    registrations: Counter<u64>,
    runs_finished: Counter<u64>,
    run_duration: Histogram<f64>,
    run_players: Histogram<u64>,
    deaths: Counter<u64>,
    kills: Counter<u64>,
    xp: Counter<u64>,
    coins: Counter<u64>,
    tick: Histogram<f64>,
    ws: UpDownCounter<i64>,
    admin_actions: Counter<u64>,
}

static METRICS: OnceLock<Metrics> = OnceLock::new();

/// The global instruments (created on first use, after `init`).
pub fn metrics() -> &'static Metrics {
    METRICS.get_or_init(|| Metrics::new(&global::meter(SERVICE_NAME)))
}

impl Metrics {
    pub fn new(m: &Meter) -> Metrics {
        Metrics {
            logins: m.u64_counter("ta.logins").with_description("Player login attempts by result").build(),
            registrations: m.u64_counter("ta.registrations").with_description("New accounts").build(),
            runs_finished: m.u64_counter("ta.runs.finished").with_description("Dungeon runs that ended").build(),
            run_duration: m.f64_histogram("ta.run.duration").with_unit("s").with_description("Length of finished runs").build(),
            run_players: m.u64_histogram("ta.run.players").with_description("Party size of finished runs").build(),
            deaths: m.u64_counter("ta.player.deaths").with_description("Heroes dead at the end of a run").build(),
            kills: m.u64_counter("ta.enemies.killed").with_description("Enemies killed").build(),
            xp: m.u64_counter("ta.xp.banked").with_description("XP earned in runs").build(),
            coins: m.u64_counter("ta.coins.banked").with_description("Coins earned in runs").build(),
            tick: m.f64_histogram("ta.tick.duration").with_unit("ms").with_description("Simulation time per server tick").build(),
            ws: m.i64_up_down_counter("ta.ws.connections").with_description("Open game connections").build(),
            admin_actions: m.u64_counter("ta.admin.actions").with_description("Changes made in the admin area").build(),
        }
    }

    /// `result`: "ok", "fail" or "throttled".
    pub fn login(&self, result: &'static str) {
        self.logins.add(1, &[KeyValue::new("result", result)]);
    }

    pub fn registration(&self) {
        self.registrations.add(1, &[]);
    }

    pub fn run_finished(&self, r: &RunRecord) {
        let boss = KeyValue::new("boss", format!("{:?}", r.boss));
        let outcome = KeyValue::new("outcome", r.outcome.as_str());
        self.runs_finished.add(1, &[boss.clone(), outcome.clone(), KeyValue::new("debug", r.debug)]);
        if r.debug {
            return; // kept out of the gameplay numbers, like in the admin stats
        }
        self.run_duration.record(r.duration_s, &[boss, outcome]);
        self.run_players.record(r.players.len() as u64, &[]);
        for p in &r.players {
            let class = [KeyValue::new("class", format!("{:?}", p.class))];
            if p.died() {
                self.deaths.add(1, &class);
            }
            self.kills.add(p.kills as u64, &class);
            self.xp.add(p.xp as u64, &class);
            self.coins.add(p.coins as u64, &class);
        }
    }

    pub fn tick_ms(&self, ms: f64) {
        self.tick.record(ms, &[]);
    }

    pub fn ws_connected(&self, open: bool) {
        self.ws.add(if open { 1 } else { -1 }, &[]);
    }

    pub fn admin_action(&self, action: &str) {
        self.admin_actions.add(1, &[KeyValue::new("action", action.to_string())]);
    }
}

/// Gauges read from the lobby at each metric export.
pub fn observe_lobby(lobby: SharedLobby) {
    static GAUGES: OnceLock<Vec<ObservableGauge<u64>>> = OnceLock::new();
    GAUGES.get_or_init(|| {
        let m = global::meter(SERVICE_NAME);
        let (a, b) = (lobby.clone(), lobby);
        vec![
            m.u64_observable_gauge("ta.players.online")
                .with_description("Players connected, in the lobby or in a dungeon")
                .with_callback(move |o| {
                    let live = a.lock().unwrap().live();
                    o.observe((live.online - live.in_run) as u64, &[KeyValue::new("state", "lobby")]);
                    o.observe(live.in_run as u64, &[KeyValue::new("state", "in_run")]);
                })
                .build(),
            m.u64_observable_gauge("ta.runs.active")
                .with_description("Dungeons running and waiting rooms open")
                .with_callback(move |o| {
                    let live = b.lock().unwrap().live();
                    o.observe(live.runs_active as u64, &[KeyValue::new("state", "running")]);
                    o.observe(live.rooms_open as u64, &[KeyValue::new("state", "waiting")]);
                })
                .build(),
        ]
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{BossId, ClassId};
    use crate::run::{Outcome, RunPlayerRecord};
    use opentelemetry::metrics::MeterProvider as _;
    use opentelemetry_sdk::metrics::data::{AggregatedMetrics, MetricData};
    use opentelemetry_sdk::metrics::InMemoryMetricExporter;

    fn record(debug: bool) -> RunRecord {
        let p = |class, survived| RunPlayerRecord { account: Some(1), character: Some(2), class, kills: 5, damage: 1.0, healing: 0.0, xp: 30, coins: 4, survived, left: false };
        RunRecord { boss: BossId::Lich, outcome: Outcome::Defeat, duration_s: 90.0, debug, players: vec![p(ClassId::Wizard, false), p(ClassId::Paladin, true)] }
    }

    #[test]
    fn without_an_endpoint_nothing_is_exported() {
        for v in ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"] {
            if std::env::var(v).is_ok() {
                return; // the developer's environment exports on purpose
            }
        }
        assert!(!otlp_configured());
        // The global no-op instruments accept everything.
        metrics().run_finished(&record(false));
        metrics().login("ok");
    }

    #[test]
    fn a_finished_run_is_counted_with_its_attributes() {
        let exporter = InMemoryMetricExporter::default();
        let provider = SdkMeterProvider::builder().with_reader(PeriodicReader::builder(exporter.clone()).build()).build();
        let m = Metrics::new(&provider.meter("test"));
        m.run_finished(&record(false));
        m.run_finished(&record(true));
        provider.force_flush().unwrap();

        let metrics = exporter.get_finished_metrics().unwrap();
        let all: Vec<_> = metrics.iter().flat_map(|rm| rm.scope_metrics()).flat_map(|sm| sm.metrics()).collect();
        let sum_of = |name: &str, want: &[(&str, &str)]| -> u64 {
            let metric = all.iter().find(|m| m.name() == name).unwrap_or_else(|| panic!("{name} missing"));
            let AggregatedMetrics::U64(MetricData::Sum(sum)) = metric.data() else { panic!("{name} is not a u64 sum") };
            sum.data_points()
                .filter(|dp| want.iter().all(|(k, v)| dp.attributes().any(|a| a.key.as_str() == *k && a.value.as_str() == *v)))
                .map(|dp| dp.value())
                .sum()
        };
        assert_eq!(sum_of("ta.runs.finished", &[("boss", "Lich"), ("outcome", "defeat"), ("debug", "false")]), 1);
        assert_eq!(sum_of("ta.runs.finished", &[("debug", "true")]), 1);
        assert_eq!(sum_of("ta.player.deaths", &[("class", "Wizard")]), 1, "the debug run is not counted");
        assert_eq!(sum_of("ta.player.deaths", &[("class", "Paladin")]), 0);
        assert_eq!(sum_of("ta.enemies.killed", &[]), 10);
        assert_eq!(sum_of("ta.xp.banked", &[("class", "Paladin")]), 30);
    }
}
