CREATE TABLE test_records (
  id uuid PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
