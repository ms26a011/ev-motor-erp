CREATE TABLE IF NOT EXISTS move_order_items (
  mo_item_id INT AUTO_INCREMENT PRIMARY KEY,
  mo_id INT NOT NULL,
  item_id INT NOT NULL,
  requested_quantity DECIMAL(14, 3) NOT NULL,
  issued_quantity DECIMAL(14, 3) NOT NULL,
  uom VARCHAR(20) NOT NULL,
  unit_cost DECIMAL(14, 2) NOT NULL,
  line_amount DECIMAL(14, 2) NOT NULL,
  source_location VARCHAR(120) NOT NULL,
  destination_location VARCHAR(120) NOT NULL,
  required_date DATE NULL,
  movement_date DATE NOT NULL,
  remarks VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_move_order_items_mo
    FOREIGN KEY (mo_id) REFERENCES move_order(mo_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_move_order_items_item
    FOREIGN KEY (item_id) REFERENCES item_master(item_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT chk_move_order_items_quantities CHECK (
    requested_quantity > 0
    AND issued_quantity > 0
  ),
  CONSTRAINT chk_move_order_items_cost CHECK (
    unit_cost >= 0
    AND line_amount = ROUND(issued_quantity * unit_cost, 2)
  ),
  CONSTRAINT chk_move_order_items_locations CHECK (
    TRIM(source_location) <> ''
    AND TRIM(destination_location) <> ''
    AND source_location <> destination_location
  ),
  CONSTRAINT chk_move_order_items_uom CHECK (TRIM(uom) <> ''),
  UNIQUE KEY uq_move_order_items_mo_item (mo_id, item_id),
  INDEX idx_move_order_items_mo (mo_id),
  INDEX idx_move_order_items_item (item_id),
  INDEX idx_move_order_items_movement_date (movement_date),
  INDEX idx_move_order_items_locations (source_location, destination_location)
);
