-- BUILD-013: LIFO Inventory Valuation Engine

CREATE TABLE lifo_layers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  layer_year INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  unit_cost DECIMAL(15, 4) NOT NULL,
  total_cost DECIMAL(15, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_lifo_layers_unique ON lifo_layers(tenant_id, account_id, layer_year);
CREATE INDEX idx_lifo_layers_account ON lifo_layers(tenant_id, account_id);
CREATE INDEX idx_lifo_layers_year ON lifo_layers(tenant_id, layer_year);
