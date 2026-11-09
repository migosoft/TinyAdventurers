//! The address a request really comes from, for the per-IP login limiters.
//!
//! Behind a reverse proxy every connection comes from the proxy. When the
//! proxy's address is listed in `TRUSTED_PROXIES`, the client's address is
//! taken from `X-Forwarded-For` instead. The header is read from the right:
//! the last entry is the one the proxy appended; entries further left were
//! written by the client and could be anything. A request from an address
//! that is not a trusted proxy keeps its peer address, so a client that
//! reaches the server directly cannot pick its own limiter key.

use crate::api::AppState;
use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::request::Parts;
use axum::http::HeaderMap;
use std::convert::Infallible;
use std::net::{IpAddr, SocketAddr};

/// One IP address or CIDR range.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Net {
    addr: IpAddr,
    prefix: u8,
}

impl Net {
    fn parse(s: &str) -> Option<Net> {
        let (a, p) = match s.split_once('/') {
            Some((a, p)) => (a, Some(p)),
            None => (s, None),
        };
        let addr = normalize(a.trim().parse().ok()?);
        let max = if addr.is_ipv4() { 32 } else { 128 };
        let prefix = match p {
            Some(p) => p.trim().parse().ok().filter(|&p| p <= max)?,
            None => max,
        };
        Some(Net { addr, prefix })
    }

    fn contains(&self, ip: IpAddr) -> bool {
        let bits = |ip: IpAddr| -> u128 {
            match ip {
                IpAddr::V4(v) => u32::from(v) as u128,
                IpAddr::V6(v) => u128::from(v),
            }
        };
        let ip = normalize(ip);
        if ip.is_ipv4() != self.addr.is_ipv4() {
            return false;
        }
        let width = if ip.is_ipv4() { 32 } else { 128 };
        let shift = width - self.prefix as u32;
        let (a, b) = (bits(ip), bits(self.addr));
        shift >= 128 || (a >> shift) == (b >> shift)
    }
}

/// An IPv4 address seen as IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is the IPv4 address.
fn normalize(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v) => v.to_ipv4_mapped().map_or(ip, IpAddr::V4),
        v4 => v4,
    }
}

/// The `TRUSTED_PROXIES` setting: addresses whose `X-Forwarded-For` is believed.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TrustedProxies(Vec<Net>);

impl TrustedProxies {
    /// Comma-separated IP addresses or CIDR ranges; empty or unset = none
    /// (the header is never read).
    pub fn parse(value: Option<&str>) -> Result<TrustedProxies, String> {
        let mut nets = Vec::new();
        for part in value.unwrap_or("").split(',').map(str::trim).filter(|p| !p.is_empty()) {
            nets.push(Net::parse(part).ok_or_else(|| format!("TRUSTED_PROXIES: {part:?} is not an IP address or CIDR range"))?);
        }
        Ok(TrustedProxies(nets))
    }

    /// `TRUSTED_PROXIES` from the environment. An invalid value stops the
    /// server: silently ignoring it would put every player in one bucket.
    pub fn from_env() -> TrustedProxies {
        TrustedProxies::parse(std::env::var("TRUSTED_PROXIES").ok().as_deref()).unwrap_or_else(|e| panic!("{e}"))
    }

    fn contains(&self, ip: IpAddr) -> bool {
        self.0.iter().any(|n| n.contains(ip))
    }
}

/// The client's address: the peer, or, when the peer is a trusted proxy, the
/// rightmost `X-Forwarded-For` entry that is not itself a trusted proxy.
/// A missing or unreadable header leaves the peer address.
pub fn client_ip(peer: IpAddr, headers: &HeaderMap, trusted: &TrustedProxies) -> IpAddr {
    let peer = normalize(peer);
    if !trusted.contains(peer) {
        return peer;
    }
    // Several header lines count as one comma-separated list, in order.
    let entries: Vec<&str> = headers.get_all("x-forwarded-for").iter().filter_map(|v| v.to_str().ok()).flat_map(|v| v.split(',')).collect();
    for e in entries.iter().rev() {
        let Ok(ip) = e.trim().parse::<IpAddr>() else { return peer };
        let ip = normalize(ip);
        if !trusted.contains(ip) {
            return ip;
        }
    }
    peer
}

/// Extractor for [`client_ip`] of the current request.
pub struct ClientIp(pub IpAddr);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let peer = parts.extensions.get::<ConnectInfo<SocketAddr>>().map_or(IpAddr::from([0, 0, 0, 0]), |c| c.0.ip());
        Ok(ClientIp(client_ip(peer, &parts.headers, &state.auth.trusted_proxies)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn xff(values: &[&str]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for v in values {
            h.append("x-forwarded-for", v.parse().unwrap());
        }
        h
    }

    fn docker() -> TrustedProxies {
        TrustedProxies::parse(Some("172.18.0.0/16")).unwrap()
    }

    #[test]
    fn parses_addresses_and_ranges() {
        assert_eq!(TrustedProxies::parse(None).unwrap(), TrustedProxies::default());
        assert_eq!(TrustedProxies::parse(Some(" , ")).unwrap(), TrustedProxies::default());
        let t = TrustedProxies::parse(Some("127.0.0.1, 172.16.0.0/12 ,fd00::/8,::1")).unwrap();
        assert!(t.contains(ip("127.0.0.1")));
        assert!(!t.contains(ip("127.0.0.2")));
        assert!(t.contains(ip("172.31.255.1")));
        assert!(!t.contains(ip("172.32.0.1")));
        assert!(t.contains(ip("fd12::5")));
        assert!(t.contains(ip("::1")));
        assert!(!t.contains(ip("fe80::1")));
        assert!(TrustedProxies::parse(Some("0.0.0.0/0")).unwrap().contains(ip("8.8.8.8")));
        for bad in ["proxy", "10.0.0.0/33", "::/129", "10.0.0.0/", "1.2.3"] {
            assert!(TrustedProxies::parse(Some(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn untrusted_peer_ignores_the_header() {
        let h = xff(&["1.2.3.4"]);
        assert_eq!(client_ip(ip("9.9.9.9"), &h, &docker()), ip("9.9.9.9"));
        assert_eq!(client_ip(ip("172.18.0.5"), &h, &TrustedProxies::default()), ip("172.18.0.5"));
    }

    #[test]
    fn trusted_peer_takes_the_rightmost_entry() {
        // The client forged the first entry; the proxy appended the real one.
        let h = xff(&["6.6.6.6, 203.0.113.7"]);
        assert_eq!(client_ip(ip("172.18.0.3"), &h, &docker()), ip("203.0.113.7"));
        // Separate header lines read as one list.
        let h = xff(&["6.6.6.6", "203.0.113.7"]);
        assert_eq!(client_ip(ip("172.18.0.3"), &h, &docker()), ip("203.0.113.7"));
    }

    #[test]
    fn chained_trusted_proxies_are_skipped() {
        let h = xff(&["6.6.6.6, 203.0.113.7, 172.18.0.9"]);
        assert_eq!(client_ip(ip("172.18.0.3"), &h, &docker()), ip("203.0.113.7"));
        // Only proxies in the header: the peer stays the key.
        let h = xff(&["172.18.0.9"]);
        assert_eq!(client_ip(ip("172.18.0.3"), &h, &docker()), ip("172.18.0.3"));
    }

    #[test]
    fn missing_or_garbage_header_keeps_the_peer() {
        assert_eq!(client_ip(ip("172.18.0.3"), &HeaderMap::new(), &docker()), ip("172.18.0.3"));
        assert_eq!(client_ip(ip("172.18.0.3"), &xff(&["1.2.3.4, unknown"]), &docker()), ip("172.18.0.3"));
        assert_eq!(client_ip(ip("172.18.0.3"), &xff(&[""]), &docker()), ip("172.18.0.3"));
    }

    #[test]
    fn mapped_ipv6_counts_as_ipv4() {
        let h = xff(&["::ffff:203.0.113.7"]);
        assert_eq!(client_ip(ip("::ffff:172.18.0.3"), &h, &docker()), ip("203.0.113.7"));
    }
}
