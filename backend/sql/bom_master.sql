CREATE TABLE IF NOT EXISTS bom_master (
  bom_id INT AUTO_INCREMENT PRIMARY KEY,
  bom_code VARCHAR(40) NOT NULL UNIQUE,
  parent_item_id INT NOT NULL,
  component_item_id INT NOT NULL,
  component_name VARCHAR(150) NOT NULL,
  component_category VARCHAR(80) NOT NULL,
  specification VARCHAR(500) NULL,
  quantity_per_unit DECIMAL(12, 3) NOT NULL,
  uom VARCHAR(20) NOT NULL,
  scrap_factor_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
  production_stage ENUM('Stator Assembly', 'Rotor Assembly', 'Final Motor Assembly', 'Testing', 'Packing') NOT NULL,
  effective_from DATE NOT NULL DEFAULT (CURRENT_DATE),
  effective_to DATE NULL,
  status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  remarks VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bom_parent_item
    FOREIGN KEY (parent_item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_bom_component_item
    FOREIGN KEY (component_item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT chk_bom_quantity CHECK (quantity_per_unit > 0),
  CONSTRAINT chk_bom_scrap CHECK (scrap_factor_percent >= 0 AND scrap_factor_percent <= 25),
  CONSTRAINT chk_bom_effective_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE KEY uq_bom_parent_component_spec (parent_item_id, component_item_id, specification),
  INDEX idx_bom_parent_item (parent_item_id),
  INDEX idx_bom_component_item (component_item_id),
  INDEX idx_bom_stage_status (production_stage, status),
  INDEX idx_bom_category (component_category)
);
