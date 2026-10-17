# Archivo: Índice de migraciones Prisma que no se pueden editar

Las migraciones históricas de Prisma son ejecutables versionados. No reciben un comentario en línea porque Prisma guarda y comprueba su checksum después de aplicarlas; cambiarlas puede impedir `prisma migrate deploy`. Este índice entrega la descripción breve que normalmente estaría en el encabezado.

| Migración | Descripción breve |
| --- | --- |
| `20260407032731_init/migration.sql` | Crea el esquema inicial de conversaciones, tenants y entidades base. |
| `20260417000100_add_conversation_priority/migration.sql` | Agrega prioridad a las conversaciones. |
| `20260418025116_add_leads/migration.sql` | Incorpora la entidad de leads comerciales. |
| `20260428000100_startup_features/migration.sql` | Agrega capacidades iniciales de usuarios y arranque. |
| `20260504000100_add_products_ai_recommendations/migration.sql` | Incorpora productos y recomendaciones asociadas a IA. |
| `20260504001000_add_services_bookings/migration.sql` | Incorpora servicios y reservas. |
| `20260505000100_ai_memory_decisions/migration.sql` | Agrega datos de memoria y decisión para conversaciones de IA. |
| `20260506000100_phase1_saas_core/migration.sql` | Amplía el núcleo SaaS de la plataforma. |
| `20260510000100_meta_tenant_routing/migration.sql` | Añade campos de ruteo Meta por tenant. |
| `20260512000100_phase5_saas_commercial/migration.sql` | Agrega configuración comercial y de IA al tenant. |
| `20260512030905/migration.sql` | Añade el rol comercial SELLER al catálogo de roles. |
| `20260522000100_add_tenant_isactive/migration.sql` | Agrega el estado activo del tenant. |
| `20260523222013/migration.sql` | Aplica cambios históricos de esquema sin nombre descriptivo en la carpeta. |
| `20260526000100_multi_tenant_ai_channels/migration.sql` | Incorpora perfiles de IA y canales multiempresa. |
| `20260610000000_add_payments/migration.sql` | Incorpora pagos al modelo de datos. |
| `20260629000100_add_industry_records/migration.sql` | Incorpora registros configurables por industria. |
| `20260629000200_add_custom_industry_templates/migration.sql` | Incorpora plantillas personalizadas por industria. |
| `20260630000100_add_workspace_user_profile/migration.sql` | Amplía el perfil de usuario del espacio de trabajo. |
| `20260715000100_add_metadata_schemas/migration.sql` | Incorpora esquemas de metadatos versionables. |
| `20260715000200_add_industry_record_schema_version/migration.sql` | Agrega versión de esquema a registros de industria. |
| `20260716000100_add_core_metadata_versions/migration.sql` | Agrega versiones de metadatos a entidades core. |
| `20260718020000_add_scheduled_job_runs/migration.sql` | Incorpora registro de ejecuciones programadas. |
| `20260719030000_add_mobile_push_devices/migration.sql` | Incorpora dispositivos para notificaciones móviles. |
| `20260830000100_add_broker_relational_core/migration.sql` | Crea el núcleo relacional de Broker OS. |
| `20260830000200_add_broker_holding_governance/migration.sql` | Incorpora gobierno holding y alcance multiempresa de Broker OS. |
| `20260831000100_add_broker_property_capture/migration.sql` | Incorpora captura inmobiliaria de propiedades. |
| `20260831000200_add_broker_sale_cases/migration.sql` | Incorpora casos de venta inmobiliaria. |
| `20260831000300_add_broker_rental_cases/migration.sql` | Incorpora casos de arriendo inmobiliario. |
| `20260831000400_add_broker_maintenance_projects/migration.sql` | Amplía mantenciones y proyectos de Broker OS. |
| `20260902000100_add_broker_post_sale_controls/migration.sql` | Incorpora inspección, entrega, postventa y garantías. |
| `20260908000100_finance_bank_import_jobs/migration.sql` | Incorpora originales bancarios y trabajos de importación. |
| `20260908000200_finance_bank_review/migration.sql` | Agrega configuración de revisión de importaciones bancarias. |
| `20260908000300_finance_period_controls/migration.sql` | Incorpora controles de períodos financieros. |
| `20260926000100_bank_import_attempts/migration.sql` | Agrega contador de intentos a trabajos de importación bancaria. |
| `20260930000100_complete_schema_migration_coverage/migration.sql` | Completa cobertura de migraciones del esquema vigente. |

## Regla de mantenimiento

Una migración ya aplicada no se modifica. Para un cambio de datos o esquema se crea una migración nueva y se agrega una fila a este índice.
