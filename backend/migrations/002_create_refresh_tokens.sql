CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_refresh_token_hash (token_hash),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
