CREATE TABLE IF NOT EXISTS programs (
    id text COLLATE "C" PRIMARY KEY,
    version integer NOT NULL CHECK (version > 0),
    state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object')
);

CREATE TABLE IF NOT EXISTS reservations (
    program_id text COLLATE "C" NOT NULL REFERENCES programs (id),
    state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
    invoice_id text COLLATE "C" GENERATED ALWAYS AS (state->>'invoiceId') STORED,
    status text GENERATED ALWAYS AS (state->>'status') STORED NOT NULL
        CHECK (status IN ('ACTIVE', 'RELEASED')),
    reserved_at text COLLATE "C" GENERATED ALWAYS AS (state->>'reservedAt') STORED NOT NULL,
    PRIMARY KEY (program_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS reservations_order ON reservations (program_id, reserved_at, invoice_id);
CREATE INDEX IF NOT EXISTS reservations_status_order ON reservations (program_id, status, reserved_at, invoice_id);
