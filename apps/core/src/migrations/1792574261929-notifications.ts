import {MigrationInterface, QueryRunner} from "typeorm";

export class Notifications1792574261929 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_sms_message" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "idempotencyKey" character varying(120) NOT NULL, "orderId" integer, "event" character varying(24) NOT NULL, "to" character varying(20) NOT NULL, "body" text NOT NULL, "language" character varying(2) NOT NULL, "unicode" boolean NOT NULL DEFAULT false, "segments" integer NOT NULL DEFAULT '1', "status" character varying(12) NOT NULL, "reason" character varying(200) NOT NULL DEFAULT '', "attempts" integer NOT NULL DEFAULT '0', "sendAfter" TIMESTAMP(6), "sentAt" TIMESTAMP(6), "providerMessageId" character varying(80), "id" SERIAL NOT NULL, CONSTRAINT "PK_60e4c83fcc17b1501221dec954e" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b46c10357e4cc732559070fc67" ON "bd_sms_message" ("idempotencyKey") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_d2f16c35d96272fa79d8b4440c" ON "bd_sms_message" ("orderId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b9d404c840bcba72b1763cb000" ON "bd_sms_message" ("to") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_20f3cabbbc009e6c2251a5efa1" ON "bd_sms_message" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_7f896fd0e5e01a073b08c3ed1e" ON "bd_sms_message" ("sendAfter") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_e36fe9240105e40d0945489057" ON "bd_sms_message" ("providerMessageId") `, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsTrackingtoken" character varying(32)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD CONSTRAINT "UQ_04a309828b5ce803d5ad4190ba1" UNIQUE ("customFieldsTrackingtoken")`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD "customFieldsSmsoptout" boolean NOT NULL DEFAULT false`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN "customFieldsSmsoptout"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP CONSTRAINT "UQ_04a309828b5ce803d5ad4190ba1"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsTrackingtoken"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_e36fe9240105e40d0945489057"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_7f896fd0e5e01a073b08c3ed1e"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_20f3cabbbc009e6c2251a5efa1"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b9d404c840bcba72b1763cb000"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_d2f16c35d96272fa79d8b4440c"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b46c10357e4cc732559070fc67"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_sms_message"`, undefined);
   }

}
