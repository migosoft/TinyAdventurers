//! The per-viewer filter: which records a player is sent, in what form, within the byte cap.

use super::record::{LineKind, LogRec, Seen};
use super::{on_for, Run};
use crate::protocol::EntSnap;
use crate::run::visibility::{object_sent, seen, Dark};
use crate::vispoly::View;
use serde::Serialize;
use ts_rs::TS;

/// Text bytes of lines in one snapshot; the rest is summed up in a closing note.
pub const LOG_BYTES_PER_SNAP: usize = 4096;

/// `[time, kind (LineKind), headline, details]`
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct LineW(pub f32, pub u8, pub String, pub Vec<String>);

/// `[tags, lines]`; `tags` is `[entity, EntityKind id, number]` for the sent entities that have one.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct LogW(pub Vec<(u32, u8, u16)>, pub Vec<LineW>);

fn sees(run: &Run, view: &View, dark: &Dark, s: &Seen) -> bool {
    if s.gone {
        return false;
    }
    if s.party {
        return true;
    }
    if s.object {
        if let Some(o) = run.objects.iter().find(|o| o.id == s.id && !o.gone) {
            return object_sent(view, &run.lights, dark, o);
        }
    }
    seen(view, &run.lights, dark, s.pos, s.radius)
}

/// The log for player `pi` looking through hero `viewed`: `None` unless they have it on.
pub fn for_viewer(run: &Run, pi: usize, viewed: u32, view: &View, dark: &Dark, ents: &[EntSnap], records: &[LogRec]) -> Option<LogW> {
    let prefs = on_for(run, run.players[pi].id)?;
    let mut lines: Vec<LineW> = Vec::new();
    let (mut bytes, mut omitted) = (0, 0);
    for r in records {
        let (head, details) = if r.who.iter().all(|s| sees(run, view, dark, s)) {
            (&r.head, &r.details)
        } else {
            match &r.unseen {
                Some(u) if u.viewer == viewed => (&u.head, &u.details),
                _ => continue,
            }
        };
        let details: &[String] = if prefs.details { details } else { &[] };
        let size = head.len() + details.iter().map(String::len).sum::<usize>();
        if omitted > 0 || bytes + size > LOG_BYTES_PER_SNAP {
            omitted += 1;
            continue;
        }
        bytes += size;
        lines.push(LineW(r.t as f32, r.kind as u8, head.clone(), details.to_vec()));
    }
    if omitted > 0 {
        lines.push(LineW(run.time as f32, LineKind::Note as u8, format!("… {omitted} more records (log limit)"), Vec::new()));
    }
    Some(LogW(super::snapshot_tags(run, ents), lines))
}
