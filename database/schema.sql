CREATE TABLE IF NOT EXISTS programs (
    id text COLLATE "C" PRIMARY KEY,
    version integer NOT NULL CHECK (version > 0),
    state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object')
);
