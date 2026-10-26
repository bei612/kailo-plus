-- Reverse of DD-151. Refuses while any device has registered: revoking push for those
-- devices is a product decision (and their tokens live in OpenBao), not a schema rollback.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM identity.push_registration) THEN
   RAISE EXCEPTION 'DD-151 push registrations exist; stop the release instead of rolling back'
     USING ERRCODE = '55000';
 END IF;
END $$;

DROP TABLE projection.push_delivery_window;
DROP TABLE projection.push_cursor;
DROP TABLE identity.push_registration;
