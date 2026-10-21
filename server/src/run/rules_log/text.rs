//! Number formatting for the log's lines.

/// One decimal, a trailing ".0" dropped, no negative zero: 9.0 is "9", 10.55 is "10.6", -0.04 is "0".
#[allow(dead_code)] // Tasks 4-6 format with it.
pub fn n1(v: f64) -> String {
    let s = format!("{:.1}", (v * 10.0).round() / 10.0);
    let s = s.strip_suffix(".0").unwrap_or(&s);
    if s == "-0" { "0".to_string() } else { s.to_string() }
}

/// A fraction as a whole percentage: 0.2 is "20 %".
#[allow(dead_code)] // Tasks 4-6 format with it.
pub fn pct(fraction: f64) -> String {
    format!("{} %", (fraction * 100.0).round() as i64)
}
