-- CreateTable
CREATE TABLE "cashflow_forecasts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forecast_date" TIMESTAMP(3) NOT NULL,
    "predicted_balance" DECIMAL(15,2) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "cashflow_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_cash_actuals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "balance" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "daily_cash_actuals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cashflow_forecasts_tenant_id_idx" ON "cashflow_forecasts"("tenant_id");

-- CreateIndex
CREATE INDEX "cashflow_forecasts_tenant_id_forecast_date_idx" ON "cashflow_forecasts"("tenant_id", "forecast_date");

-- CreateIndex
CREATE INDEX "daily_cash_actuals_tenant_id_idx" ON "daily_cash_actuals"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_cash_actuals_tenant_id_date_key" ON "daily_cash_actuals"("tenant_id", "date");

