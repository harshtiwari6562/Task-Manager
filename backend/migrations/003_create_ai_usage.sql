CREATE TABLE IF NOT EXISTS ai_usage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  endpoint VARCHAR(50) NOT NULL DEFAULT 'generate-skill',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ai_usage_user_time (user_id, created_at),
  INDEX idx_ai_usage_time (created_at),
  CONSTRAINT fk_ai_usage_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
