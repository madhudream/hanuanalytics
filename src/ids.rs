//! Time-ordered ids and random keys. Ids sort by creation time, which keeps HanuDB's keyword index tidy.
use rand::RngCore;

const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// `<prefix>_<10 chars of time base36><10 random chars>`
pub fn new_id(prefix: &str) -> String {
    let mut t = now_ms() as u64;
    let mut time = [b'0'; 9];
    for i in (0..9).rev() {
        time[i] = ALPHABET[(t % 36) as usize];
        t /= 36;
    }
    let mut r = [0u8; 10];
    rand::rng().fill_bytes(&mut r);
    let rand: String = r.iter().map(|b| ALPHABET[(*b % 36) as usize] as char).collect();
    format!("{prefix}_{}{rand}", std::str::from_utf8(&time).unwrap())
}

pub fn random_key(prefix: &str, len: usize) -> String {
    let mut r = vec![0u8; len];
    rand::rng().fill_bytes(&mut r);
    let s: String = r.iter().map(|b| ALPHABET[(*b % 36) as usize] as char).collect();
    format!("{prefix}{s}")
}

pub fn random_hex(bytes: usize) -> String {
    let mut r = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut r);
    hex::encode(r)
}
