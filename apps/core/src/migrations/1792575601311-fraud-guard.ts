import {MigrationInterface, QueryRunner} from "typeorm";

export class FraudGuard1792575601311 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_incomplete_checkout" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "status" character varying(16) NOT NULL, "phone" character varying(20), "name" character varying(120), "districtId" character varying(16), "thanaId" character varying(24), "cart" text, "cartTotal" integer NOT NULL DEFAULT '0', "source" text, "language" character varying(2) NOT NULL DEFAULT 'bn', "orderId" integer, "dismissReason" character varying(24), "closedBy" character varying(120), "closedAt" TIMESTAMP, "smsSentAt" TIMESTAMP, "id" SERIAL NOT NULL, CONSTRAINT "PK_558d107e385b4b724760fa27d2d" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_3ef906807ea7e73205b676d406" ON "bd_incomplete_checkout" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_be58586a04ae79f67a508e30e3" ON "bd_incomplete_checkout" ("phone") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_bd_incomplete_checkout_open_phone" ON "bd_incomplete_checkout" ("phone") WHERE "status" = 'open'`, undefined);
        await queryRunner.query(`CREATE TABLE "bd_block_entry" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "kind" character varying(8) NOT NULL, "value" character varying(64) NOT NULL, "expiresAt" TIMESTAMP, "note" character varying(500) NOT NULL DEFAULT '', "addedBy" character varying(120) NOT NULL DEFAULT '', "removedAt" TIMESTAMP, "removedBy" character varying(120), "removedReason" character varying(500), "id" SERIAL NOT NULL, CONSTRAINT "PK_eaf8d998ea0733bd2a21554fc9b" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_e8d3f21731c96a8b01a3442b1b" ON "bd_block_entry" ("value") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_bca5429e2389b9b3b4da49143f" ON "bd_block_entry" ("removedAt") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_otp_code" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "phone" character varying(20) NOT NULL, "orderId" integer NOT NULL, "codeHash" character varying(64) NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "verifiedAt" TIMESTAMP, "id" SERIAL NOT NULL, CONSTRAINT "PK_d4ca17830a1d30dafb0d6a0f0ec" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_0554566f180c16d8e4f938ae92" ON "bd_otp_code" ("phone") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_15cb0f3ad18b2f452b71766ee7" ON "bd_otp_code" ("orderId") `, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsRiskscore" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsRiskreasons" text`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsOtpstatus" character varying(12)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsOtpstatus"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsRiskreasons"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsRiskscore"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_15cb0f3ad18b2f452b71766ee7"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_0554566f180c16d8e4f938ae92"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_otp_code"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_bca5429e2389b9b3b4da49143f"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e8d3f21731c96a8b01a3442b1b"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_block_entry"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_bd_incomplete_checkout_open_phone"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_be58586a04ae79f67a508e30e3"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_3ef906807ea7e73205b676d406"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_incomplete_checkout"`, undefined);
   }

}
