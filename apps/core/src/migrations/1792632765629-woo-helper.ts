import {MigrationInterface, QueryRunner} from "typeorm";

export class WooHelper1792632765629 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "woo_pairing" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "sourceId" integer NOT NULL, "codeHash" character varying(64) NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "usedAt" TIMESTAMP, "token" text, "tokenExpiresAt" TIMESTAMP, "nextSequence" integer NOT NULL DEFAULT '0', "finished" boolean NOT NULL DEFAULT false, "manifest" jsonb NOT NULL DEFAULT '{}', "id" SERIAL NOT NULL, CONSTRAINT "PK_704d37c157da5eae46396a49e79" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "woo_chunk" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "pairingId" integer NOT NULL, "sequence" integer NOT NULL, "digest" character varying(64) NOT NULL, "nonce" character varying(64) NOT NULL, "kind" character varying(24) NOT NULL, "recordCount" integer NOT NULL, "payload" text NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "PK_e8ee67681d8d8699d6445befd5a" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_78e75009da12816a8fa3b72a27" ON "woo_chunk" ("pairingId", "sequence") `, undefined);
        await queryRunner.query(`CREATE TABLE "woo_legacy_auth" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "reference" character varying(64) NOT NULL, "customerId" integer NOT NULL, "sourceId" integer NOT NULL, "secret" text NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "PK_4ab2039c01946b17a06727dc86f" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_da9f8a69db951f3c74815bd6a6" ON "woo_legacy_auth" ("customerId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_7dd9867205e7399466abfdab16" ON "woo_legacy_auth" ("reference") `, undefined);
        await queryRunner.query(`CREATE TABLE "woo_redirect" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" integer NOT NULL, "sourceId" integer NOT NULL, "path" character varying(1000) NOT NULL, "target" character varying(1000), "status" integer NOT NULL DEFAULT '301', "hits" integer NOT NULL DEFAULT '0', "id" SERIAL NOT NULL, CONSTRAINT "PK_47338a05a90710351a0216e4d77" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2f24bbb32a84f66b5d80dc0368" ON "woo_redirect" ("channelId", "path") `, undefined);
        await queryRunner.query(`CREATE TABLE "woo_miss" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "channelId" integer NOT NULL, "path" character varying(1000) NOT NULL, "hits" integer NOT NULL DEFAULT '1', "id" SERIAL NOT NULL, CONSTRAINT "PK_61b4d93c4084607986b92784a24" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f0fd08b0e283c23e1dddc98c15" ON "woo_miss" ("channelId", "path") `, undefined);
        await queryRunner.query(`CREATE TABLE "woo_extra" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "sourceId" integer NOT NULL, "kind" character varying(24) NOT NULL, "sourceKey" character varying(100) NOT NULL, "data" jsonb NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "PK_d56c2f3c51828cc98f05af4f74f" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d4570ff3b18f85910b4fbfeca3" ON "woo_extra" ("sourceId", "kind", "sourceKey") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_d4570ff3b18f85910b4fbfeca3"`, undefined);
        await queryRunner.query(`DROP TABLE "woo_extra"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_f0fd08b0e283c23e1dddc98c15"`, undefined);
        await queryRunner.query(`DROP TABLE "woo_miss"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_2f24bbb32a84f66b5d80dc0368"`, undefined);
        await queryRunner.query(`DROP TABLE "woo_redirect"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_7dd9867205e7399466abfdab16"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_da9f8a69db951f3c74815bd6a6"`, undefined);
        await queryRunner.query(`DROP TABLE "woo_legacy_auth"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_78e75009da12816a8fa3b72a27"`, undefined);
        await queryRunner.query(`DROP TABLE "woo_chunk"`, undefined);
        await queryRunner.query(`DROP TABLE "woo_pairing"`, undefined);
   }

}
