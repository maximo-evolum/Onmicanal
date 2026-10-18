#!/bin/sh
# Archivo: Aplica migraciones de desarrollo antes de iniciar el backend local de EVOLUM OS.
set -eu

npx prisma migrate deploy
exec node src/server.js
