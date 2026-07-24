CREATE TABLE IF NOT EXISTS user_account (
  account_id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  username VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('DEPARTMENT_USER', 'SECTION_HEAD') NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_account_username (username),
  UNIQUE KEY uq_user_account_employee (employee_id),
  CONSTRAINT fk_user_account_employee
    FOREIGN KEY (employee_id) REFERENCES employee_master(employee_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
