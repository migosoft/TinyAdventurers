//! Accounts without personal data: a name and an Argon2id password hash.
//! Sessions are random ids handed to the browser inside an HMAC-SHA256-signed
//! token (an HttpOnly cookie). The signature lets forged or garbled tokens be
//! rejected without a database query; the database (`sessions`, which only
//! stores a SHA-256 of the id) makes logout and account deletion immediate.

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const COOKIE: &str = "ta_session";
pub const SESSION_DAYS: u64 = 30;
pub const SESSION_SECS: u64 = SESSION_DAYS * 24 * 3600;

pub const NAME_MIN: usize = 3;
pub const NAME_MAX: usize = 16;
pub const PASSWORD_MIN: usize = 8;
pub const PASSWORD_MAX: usize = 128;

type HmacSha256 = Hmac<Sha256>;

pub struct Auth {
    secret: Vec<u8>,
    /// Adds `Secure` to the cookie (set when served over HTTPS).
    pub secure_cookie: bool,
    pub limiter: Mutex<Limiter>,
}

/// A freshly issued session: the cookie value for the browser and the hash
/// the database keeps.
pub struct NewSession {
    pub token: String,
    pub id_hash: Vec<u8>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

pub fn sha256(bytes: &[u8]) -> Vec<u8> {
    Sha256::digest(bytes).to_vec()
}

impl Auth {
    /// `secret` must be long and random (see `.env.example`).
    pub fn new(secret: &[u8], secure_cookie: bool) -> Auth {
        assert!(secret.len() >= 32, "SESSION_SECRET must be at least 32 characters");
        Auth { secret: secret.to_vec(), secure_cookie, limiter: Mutex::new(Limiter::default()) }
    }

    fn mac(&self, payload: &[u8]) -> HmacSha256 {
        let mut mac = HmacSha256::new_from_slice(&self.secret).expect("hmac accepts any key length");
        mac.update(payload);
        mac
    }

    pub fn new_session(&self) -> NewSession {
        let mut sid = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut sid);
        self.sign(&sid, now_secs() + SESSION_SECS)
    }

    fn sign(&self, sid: &[u8; 32], exp: u64) -> NewSession {
        let mut payload = sid.to_vec();
        payload.extend_from_slice(&exp.to_be_bytes());
        let tag = self.mac(&payload).finalize().into_bytes();
        NewSession { token: format!("{}.{}", B64.encode(&payload), B64.encode(tag)), id_hash: sha256(sid) }
    }

    /// Checks signature and expiry; returns the session id hash to look up.
    pub fn verify(&self, token: &str) -> Option<Vec<u8>> {
        let (payload, tag) = token.split_once('.')?;
        let payload = B64.decode(payload).ok()?;
        let tag = B64.decode(tag).ok()?;
        if payload.len() != 40 {
            return None;
        }
        self.mac(&payload).verify_slice(&tag).ok()?;
        let exp = u64::from_be_bytes(payload[32..].try_into().ok()?);
        if exp <= now_secs() {
            return None;
        }
        Some(sha256(&payload[..32]))
    }

    pub fn set_cookie(&self, token: &str) -> String {
        format!("{COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_SECS}{}", if self.secure_cookie { "; Secure" } else { "" })
    }

    pub fn clear_cookie(&self) -> String {
        format!("{COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0{}", if self.secure_cookie { "; Secure" } else { "" })
    }
}

/// The session token from a `Cookie` header.
pub fn cookie_token(header: &str) -> Option<&str> {
    header.split(';').map(str::trim).find_map(|kv| kv.strip_prefix(COOKIE)?.strip_prefix('='))
}

// ------------------------------------------------------------------ passwords

/// Argon2id with the OWASP minimum parameters (19 MiB, 2 passes, 1 lane).
fn argon2() -> Argon2<'static> {
    Argon2::new(Algorithm::Argon2id, Version::V0x13, Params::new(19 * 1024, 2, 1, None).expect("argon2 params"))
}

/// Slow (tens of ms): call from `spawn_blocking`.
pub fn hash_password(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    argon2().hash_password(password.as_bytes(), &salt).expect("argon2 hash").to_string()
}

/// Slow (tens of ms): call from `spawn_blocking`. `None` checks against a
/// dummy hash, so a login for an unknown name takes as long as a real one.
pub fn verify_password(password: &str, hash: Option<&str>) -> bool {
    static DUMMY: OnceLock<String> = OnceLock::new();
    let dummy = DUMMY.get_or_init(|| hash_password("not-a-real-password"));
    let Ok(parsed) = PasswordHash::new(hash.unwrap_or(dummy)) else { return false };
    argon2().verify_password(password.as_bytes(), &parsed).is_ok() && hash.is_some()
}

// ----------------------------------------------------------------- validation

/// Account and character names: 3-16 of `A-Z a-z 0-9 _ -`.
pub fn check_name(name: &str) -> Result<(), String> {
    let len = name.chars().count();
    if !(NAME_MIN..=NAME_MAX).contains(&len) {
        return Err(format!("Names need {NAME_MIN} to {NAME_MAX} characters."));
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Names may only use letters, digits, _ and -.".into());
    }
    Ok(())
}

pub fn check_password(password: &str) -> Result<(), String> {
    let len = password.chars().count();
    if !(PASSWORD_MIN..=PASSWORD_MAX).contains(&len) {
        return Err(format!("Passwords need {PASSWORD_MIN} to {PASSWORD_MAX} characters."));
    }
    Ok(())
}

// -------------------------------------------------------------- rate limiting

/// Counts failures per key (an IP or an account name) inside a time window.
#[derive(Default)]
pub struct Limiter {
    hits: HashMap<String, (u32, Instant)>,
}

impl Limiter {
    /// True while `key` has `max` or more hits in its current window.
    pub fn blocked(&mut self, key: &str, max: u32, window: Duration) -> bool {
        self.blocked_at(key, max, window, Instant::now())
    }

    pub fn hit(&mut self, key: &str, window: Duration) {
        self.hit_at(key, window, Instant::now())
    }

    pub fn clear(&mut self, key: &str) {
        self.hits.remove(key);
    }

    fn blocked_at(&mut self, key: &str, max: u32, window: Duration, now: Instant) -> bool {
        match self.hits.get(key) {
            Some(&(n, start)) if now.duration_since(start) < window => n >= max,
            _ => false,
        }
    }

    fn hit_at(&mut self, key: &str, window: Duration, now: Instant) {
        if self.hits.len() > 10_000 {
            // Forget old windows so the map cannot grow without bound.
            self.hits.retain(|_, (_, start)| now.duration_since(*start) < window);
        }
        let e = self.hits.entry(key.to_string()).or_insert((0, now));
        if now.duration_since(e.1) >= window {
            *e = (0, now);
        }
        e.0 += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn auth() -> Auth {
        Auth::new(b"0123456789abcdef0123456789abcdef", false)
    }

    #[test]
    fn tokens_verify_and_reject_tampering() {
        let a = auth();
        let s = a.new_session();
        assert_eq!(a.verify(&s.token), Some(s.id_hash.clone()));

        // Flip one character of the payload: the signature no longer matches.
        let mut bad = s.token.clone().into_bytes();
        bad[3] = if bad[3] == b'A' { b'B' } else { b'A' };
        assert_eq!(a.verify(std::str::from_utf8(&bad).unwrap()), None);

        // A different secret does not accept it.
        let other = Auth::new(b"another-secret-another-secret-xx", false);
        assert_eq!(other.verify(&s.token), None);

        for junk in ["", ".", "abc", "abc.def", "a.b.c"] {
            assert_eq!(a.verify(junk), None, "{junk:?}");
        }
    }

    #[test]
    fn expired_tokens_are_rejected() {
        let a = auth();
        let expired = a.sign(&[7u8; 32], now_secs() - 1);
        assert_eq!(a.verify(&expired.token), None);
        let valid = a.sign(&[7u8; 32], now_secs() + 60);
        assert!(a.verify(&valid.token).is_some());
    }

    #[test]
    fn cookie_header_parsing() {
        assert_eq!(cookie_token("a=1; ta_session=xyz.abc; b=2"), Some("xyz.abc"));
        assert_eq!(cookie_token("ta_session_old=1"), None);
        assert_eq!(cookie_token("other=1"), None);
        assert!(auth().set_cookie("t").contains("HttpOnly"));
    }

    #[test]
    fn passwords_hash_and_verify() {
        let h = hash_password("correct horse");
        assert!(h.starts_with("$argon2id$"));
        assert!(verify_password("correct horse", Some(&h)));
        assert!(!verify_password("wrong horse", Some(&h)));
        assert!(!verify_password("correct horse", None));
    }

    #[test]
    fn names_and_passwords_are_validated() {
        assert!(check_name("Bob_the-2nd").is_ok());
        assert!(check_name("ab").is_err());
        assert!(check_name("a".repeat(17).as_str()).is_err());
        assert!(check_name("bad name").is_err());
        assert!(check_name("Zoë123").is_err());
        assert!(check_password("1234567").is_err());
        assert!(check_password("12345678").is_ok());
        assert!(check_password(&"x".repeat(129)).is_err());
    }

    #[test]
    fn limiter_blocks_inside_the_window_only() {
        let mut l = Limiter::default();
        let w = Duration::from_secs(30);
        let t0 = Instant::now();
        for _ in 0..5 {
            assert!(!l.blocked_at("k", 5, w, t0));
            l.hit_at("k", w, t0);
        }
        assert!(l.blocked_at("k", 5, w, t0));
        assert!(!l.blocked_at("other", 5, w, t0));
        assert!(!l.blocked_at("k", 5, w, t0 + w), "window over");
        l.hit_at("k", w, t0 + w);
        assert!(!l.blocked_at("k", 5, w, t0 + w), "counter restarted");
        l.clear("k");
        assert!(!l.blocked_at("k", 5, w, t0));
    }
}
