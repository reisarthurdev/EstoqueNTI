CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('admin','tecnico','leitor') NOT NULL DEFAULT 'tecnico',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS locations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS equipments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  asset_tag VARCHAR(50) UNIQUE,
  serial_number VARCHAR(100),
  brand VARCHAR(80),
  model VARCHAR(80),
  category_id INT UNSIGNED NULL,
  location_id INT UNSIGNED NULL,
  quantity INT NOT NULL DEFAULT 0,
  min_quantity INT NOT NULL DEFAULT 0,
  unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('disponivel','em_uso','manutencao','baixado','indisponivel') NOT NULL DEFAULT 'disponivel',
  purchase_date DATE,
  warranty_until DATE,
  notes TEXT,
  image_url VARCHAR(500),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_equipments_quantity CHECK (quantity >= 0),
  CONSTRAINT fk_equipments_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_equipments_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
  INDEX idx_equipments_name (name),
  INDEX idx_equipments_status (status),
  INDEX idx_equipments_serial (serial_number)
);

CREATE TABLE IF NOT EXISTS movements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  equipment_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NULL,
  type ENUM('entrada','saida','ajuste') NOT NULL,
  quantity INT NOT NULL,
  balance_after INT NOT NULL,
  responsible VARCHAR(150),
  note VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_movements_equipment FOREIGN KEY (equipment_id) REFERENCES equipments(id) ON DELETE CASCADE,
  CONSTRAINT fk_movements_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_movements_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
  INDEX idx_movements_equipment (equipment_id, created_at)
);
