-- Light Maestro — Licence backend (MySQL / LWS)
-- Exécuter ce script dans phpMyAdmin (base créée côté LWS).

-- Table des utilisateurs / licences.
-- Édition stockée directement (paiement unique) : mise à jour par le webhook Stripe.
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) DEFAULT NULL,
  edition ENUM('free','standard','full') NOT NULL DEFAULT 'free',
  stripe_customer_id VARCHAR(255) DEFAULT NULL,
  password_reset_token VARCHAR(64) DEFAULT NULL,
  password_reset_expires DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table d'audit des paiements (optionnelle mais utile pour le support / SAV).
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  stripe_payment_intent VARCHAR(255) NOT NULL,
  edition ENUM('standard','full') NOT NULL,
  amount_cents INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payment_intent (stripe_payment_intent),
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table de tracking des téléchargements (log + alerte admin).
CREATE TABLE IF NOT EXISTS downloads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  file ENUM('portable','setup') NOT NULL,
  ip VARCHAR(45) DEFAULT NULL,
  downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table des fixtures custom partagées (uploadées par les utilisateurs).
CREATE TABLE IF NOT EXISTS custom_fixtures (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  def_id VARCHAR(255) NOT NULL,
  manufacturer VARCHAR(255) NOT NULL,
  model VARCHAR(255) NOT NULL,
  type VARCHAR(100) DEFAULT 'Other',
  channels INT NOT NULL,
  modes JSON DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_def_id (def_id),
  KEY idx_user (user_id),
  KEY idx_manufacturer_model (manufacturer(100), model(100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table de stockage des définitions complètes (JSON).
CREATE TABLE IF NOT EXISTS custom_fixture_defs (
  fixture_id INT PRIMARY KEY,
  definition LONGTEXT DEFAULT NULL,
  FOREIGN KEY (fixture_id) REFERENCES custom_fixtures(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
