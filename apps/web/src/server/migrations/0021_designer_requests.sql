-- Choosing "Product designer" in onboarding asks for designer access; an owner approves it.
ALTER TABLE user_profile ADD COLUMN requested_role TEXT CHECK (requested_role IS NULL OR requested_role IN ('designer'));
