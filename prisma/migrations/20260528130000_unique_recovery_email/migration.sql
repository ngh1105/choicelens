-- Make recovery email unique so the recovery lookup cannot collide between
-- two accounts that happen to share an email. Multiple NULLs remain allowed
-- by default in Postgres unique indexes, which is what we want for users
-- who never set a recovery email.
CREATE UNIQUE INDEX "User_recoveryEmail_key" ON "User"("recoveryEmail");
