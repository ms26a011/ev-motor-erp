CREATE TABLE IF NOT EXISTS import_history (
  import_id INT AUTO_INCREMENT PRIMARY KEY,
  import_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  imported_by VARCHAR(100) NULL,
  file_name VARCHAR(255) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  table_name VARCHAR(100) NOT NULL,
  records_imported INT NOT NULL DEFAULT 0,
  records_skipped INT NOT NULL DEFAULT 0,
  records_failed INT NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL,
  UNIQUE KEY uq_import_file_table (file_hash, table_name)
);

CREATE TABLE IF NOT EXISTS import_errors (
  import_error_id INT AUTO_INCREMENT PRIMARY KEY,
  import_id INT NULL,
  `row_number` INT NOT NULL,
  table_name VARCHAR(100) NOT NULL,
  error_message VARCHAR(1000) NOT NULL,
  raw_data JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_import_errors_history FOREIGN KEY (import_id) REFERENCES import_history(import_id)
);
