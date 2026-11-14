-- Wording only. Backup envelopes, restore checks, permissions and application data are unchanged.
BEGIN;
DO $wording$
DECLARE catalog jsonb:=app_private.translation_keys();
BEGIN
 catalog:=catalog || $keys${"Compress backup (.json.gz)": "interface.messages.backup_compress", "JSON or gzip (.json.gz) backups. Compression does not encrypt the file.": "interface.messages.backup_compression_help", "Compression is not supported in this browser. Use a JSON backup.": "interface.messages.backup_compression_unavailable", "Decompression is not supported in this browser. Open a JSON backup.": "interface.messages.backup_decompression_unavailable", "The compressed backup is damaged or incomplete.": "interface.messages.backup_gzip_damaged", "Backup exceeds 20 MB when opened.": "interface.messages.backup_opened_too_large"}$keys$::jsonb;
 EXECUTE format('CREATE OR REPLACE FUNCTION app_private.translation_keys() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='''' AS %L','SELECT '||quote_literal(catalog::text)||'::jsonb');
END $wording$;
NOTIFY pgrst,'reload schema';
COMMIT;
