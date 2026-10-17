/** Archivo: Evita que los comandos de QA de Broker OS lean secretos desde archivos .env. */
import { blockDotEnvReads } from './qa-runtime.mjs';

blockDotEnvReads();
