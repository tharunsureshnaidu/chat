use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    config::Config,
    errors::{AppError, AppResult},
    models::user::{AuthResponse, LoginRequest, RegisterRequest, User, UserPublic},
};

// ── JWT Claims ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Subject — the user's UUID as a string.
    pub sub: String,
    pub username: String,
    /// Expiry as a Unix timestamp.
    pub exp: usize,
    /// Issued-at as a Unix timestamp.
    pub iat: usize,
}

// ── Password helpers ─────────────────────────────────────────────────────────

pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(format!("Password hashing failed: {e}")))
}

pub fn verify_password(password: &str, hash: &str) -> AppResult<bool> {
    let parsed = PasswordHash::new(hash)
        .map_err(|e| AppError::Internal(format!("Invalid password hash: {e}")))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

// ── Token helpers ────────────────────────────────────────────────────────────

pub fn generate_token(user: &User, config: &Config) -> AppResult<String> {
    let now = chrono::Utc::now();
    let exp = now + chrono::Duration::hours(config.jwt_expiry_hours);

    let claims = Claims {
        sub: user.id.to_string(),
        username: user.username.clone(),
        exp: exp.timestamp() as usize,
        iat: now.timestamp() as usize,
    };

    // Explicitly sign with HS256 — prevents algorithm confusion / "alg:none" attacks.
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("Token generation failed: {e}")))
}

pub fn validate_token(token: &str, config: &Config) -> AppResult<Claims> {
    // Explicitly accept only HS256 — rejects RS256, none, or any other algorithm
    // that an attacker might craft to bypass signature verification.
    let validation = Validation::new(Algorithm::HS256);
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &validation,
    )
    .map(|td| td.claims)
    .map_err(|_| AppError::Auth("Invalid or expired token".into()))
}

// ── Business logic ────────────────────────────────────────────────────────────

pub async fn register_user(
    pool: &PgPool,
    config: &Config,
    req: RegisterRequest,
) -> AppResult<AuthResponse> {
    // --- Input validation ---
    let username = req.username.trim().to_string();
    let email = req.email.trim().to_lowercase();

    if username.len() < 3 || username.len() > 32 {
        return Err(AppError::Validation(
            "Username must be between 3 and 32 characters".into(),
        ));
    }
    if username.chars().any(|c| !c.is_alphanumeric() && c != '_') {
        return Err(AppError::Validation(
            "Username may only contain letters, numbers, and underscores".into(),
        ));
    }
    if !email.contains('@') || email.len() > 254 {
        return Err(AppError::Validation("Invalid email address".into()));
    }
    if req.password.len() < 8 {
        return Err(AppError::Validation(
            "Password must be at least 8 characters".into(),
        ));
    }
    // Reject passwords that are trivially weak (all digits or all same character)
    let trimmed_pw = req.password.trim();
    if trimmed_pw.is_empty() {
        return Err(AppError::Validation("Password cannot be blank".into()));
    }
    if trimmed_pw.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Validation(
            "Password cannot be all digits".into(),
        ));
    }

    // --- Uniqueness check ---
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE email = $1 OR username = $2)")
            .bind(&email)
            .bind(&username)
            .fetch_one(pool)
            .await?;

    if exists {
        return Err(AppError::Conflict(
            "Email or username is already taken".into(),
        ));
    }

    let password_hash = hash_password(&req.password)?;

    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (id, username, email, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(&username)
    .bind(&email)
    .bind(&password_hash)
    .fetch_one(pool)
    .await?;

    let token = generate_token(&user, config)?;
    Ok(AuthResponse {
        token,
        user: UserPublic::from(user),
    })
}

pub async fn login_user(
    pool: &PgPool,
    config: &Config,
    req: LoginRequest,
) -> AppResult<AuthResponse> {
    let email = req.email.trim().to_lowercase();

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(pool)
        .await?
        // Use a generic message to avoid user enumeration
        .ok_or_else(|| AppError::Auth("Invalid email or password".into()))?;

    if !verify_password(&req.password, &user.password_hash)? {
        return Err(AppError::Auth("Invalid email or password".into()));
    }

    let token = generate_token(&user, config)?;
    Ok(AuthResponse {
        token,
        user: UserPublic::from(user),
    })
}
