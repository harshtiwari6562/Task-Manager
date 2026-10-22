CREATE TABLE IF NOT EXISTS user_data_tombstones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  `key` VARCHAR(200) NOT NULL,
  deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tombstones_user_time (user_id, deleted_at),
  INDEX idx_tombstones_user_key (user_id, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
