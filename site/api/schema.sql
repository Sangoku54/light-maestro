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