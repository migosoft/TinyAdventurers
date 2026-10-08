use std::f64::consts::PI;

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub const ZERO: Vec2 = Vec2 { x: 0.0, y: 0.0 };

    pub fn new(x: f64, y: f64) -> Self {
        Vec2 { x, y }
    }
    pub fn from_angle(a: f64) -> Self {
        Vec2 { x: a.cos(), y: a.sin() }
    }
    pub fn len(self) -> f64 {
        (self.x * self.x + self.y * self.y).sqrt()
    }
    pub fn dist(self, o: Vec2) -> f64 {
        (self - o).len()
    }
    pub fn dist2(self, o: Vec2) -> f64 {
        let d = self - o;
        d.x * d.x + d.y * d.y
    }
    pub fn norm(self) -> Vec2 {
        let l = self.len();
        if l < 1e-9 {
            Vec2::ZERO
        } else {
            Vec2 { x: self.x / l, y: self.y / l }
        }
    }
    /// Turned a quarter turn (same length).
    pub fn perp(self) -> Vec2 {
        Vec2 { x: -self.y, y: self.x }
    }
    pub fn angle(self) -> f64 {
        self.y.atan2(self.x)
    }
    pub fn angle_to(self, o: Vec2) -> f64 {
        (o - self).angle()
    }
}

impl std::ops::Add for Vec2 {
    type Output = Vec2;
    fn add(self, o: Vec2) -> Vec2 {
        Vec2 { x: self.x + o.x, y: self.y + o.y }
    }
}
impl std::ops::Sub for Vec2 {
    type Output = Vec2;
    fn sub(self, o: Vec2) -> Vec2 {
        Vec2 { x: self.x - o.x, y: self.y - o.y }
    }
}
impl std::ops::Mul<f64> for Vec2 {
    type Output = Vec2;
    fn mul(self, s: f64) -> Vec2 {
        Vec2 { x: self.x * s, y: self.y * s }
    }
}

/// Smallest signed difference between two angles, in [-PI, PI].
pub fn angle_diff(a: f64, b: f64) -> f64 {
    let mut d = (a - b) % (2.0 * PI);
    if d > PI {
        d -= 2.0 * PI;
    }
    if d < -PI {
        d += 2.0 * PI;
    }
    d
}
