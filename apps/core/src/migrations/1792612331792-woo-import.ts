import {MigrationInterface, QueryRunner} from "typeorm";

export class WooImport1792612331792 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "woo_source" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" integer NOT NULL, "url" character varying(500) NOT NULL, "credentials" text, "imageHosts" jsonb NOT NULL DEFAULT '[]', "settings" jsonb NOT NULL DEFAULT '{}', "lastSyncedAt" TIMESTAMP, "completed" boolean NOT NULL DEFAULT false, "id" SERIAL NOT NULL, CONSTRAINT "PK_25244b18ac777b980693d83e9a6" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_25b28a4a32f3a275248a31fd16" ON "woo_source" ("channelId", "url") `, undefined);
        await queryRunner.query(`CREATE TABLE "woo_run" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "sourceId" integer NOT NULL, "mode" character varying(24) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'queued', "watermark" TIMESTAMP NOT NULL, "modifiedAfter" TIMESTAMP, "cursor" jsonb NOT NULL DEFAULT '{"stage":0,"offset":0,"size":100}', "counts" jsonb NOT NULL DEFAULT '{}', "verification" jsonb NOT NULL DEFAULT '{}', "leaseUntil" TIMESTAMP, "leaseOwner" character varying, "error" character varying, "id" SERIAL NOT NULL, CONSTRAINT "PK_6b8a7d58b53503210c7bf09b9ab" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_c6fa6b37a6f2604e8ba2329c2b" ON "woo_run" ("sourceId", "createdAt") `, undefined);
        await queryRunner.query(`CREATE TABLE "woo_mapping" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "sourceId" integer NOT NULL, "kind" character varying(32) NOT NULL, "sourceKey" character varying(600) NOT NULL, "targetId" character varying, "digest" character varying(64) NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}', "id" SERIAL NOT NULL, CONSTRAINT "PK_a2b224e9d7b8be3a30d88d5ce4d" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1e786c1994c75ebfd2495b1f33" ON "woo_mapping" ("sourceId", "kind", "sourceKey") `, undefined);
        await queryRunner.query(`CREATE TABLE "woo_issue" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "runId" integer NOT NULL, "kind" character varying(32) NOT NULL, "sourceKey" character varying(100) NOT NULL, "code" character varying(64) NOT NULL, "severity" character varying(16) NOT NULL DEFAULT 'warning', "id" SERIAL NOT NULL, CONSTRAINT "PK_1c76409a2bcb745f15909460a22" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_7fef4c32a93def29042b1575fa" ON "woo_issue" ("runId", "createdAt") `, undefined);
        await queryRunner.query(`CREATE TABLE "woo_legacy_order" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" integer NOT NULL, "sourceId" integer NOT NULL, "sourceOrderId" character varying(100) NOT NULL, "number" character varying(100) NOT NULL, "status" character varying(64) NOT NULL, "currency" character varying(8) NOT NULL, "total" bigint NOT NULL, "refunded" bigint NOT NULL DEFAULT '0', "placedAt" TIMESTAMP, "customerId" integer, "phone" character varying(30), "snapshot" jsonb NOT NULL, "liveOrderId" integer, "id" SERIAL NOT NULL, CONSTRAINT "PK_7c2f3b863a816a65cda8ab04d4a" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_f8dedafa06e1753027650f12a7" ON "woo_legacy_order" ("channelId", "customerId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f3a41ab3710512c1d6581e863b" ON "woo_legacy_order" ("sourceId", "sourceOrderId") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_f3a41ab3710512c1d6581e863b"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_f8dedafa06e1753027650f12a7"`, undefined);
        await queryRunner.query(`DROP TABLE "woo_legacy_order"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_7fef4c32a93def29042b1575fa"`, undefined);
        await queryRunner.query(`DROP TABLE "woo_issue"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_1e786c1994c75ebfd2495b1f33"`, undefined);
        await queryRunner.query(`DROP TABLE "woo_mapping"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_c6fa6b37a6f2604e8ba2329c2b"`, undefined);
        await queryRunner.query(`DROP TABLE "woo_run"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_25b28a4a32f3a275248a31fd16"`, undefined);
        await queryRunner.query(`DROP TABLE "woo_source"`, undefined);
   }

}
