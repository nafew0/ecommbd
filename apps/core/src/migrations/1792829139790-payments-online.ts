import {MigrationInterface, QueryRunner} from "typeorm";

export class PaymentsOnline1792829139790 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_payment_attempt" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "token" character varying(40) NOT NULL, "orderId" integer NOT NULL, "paymentId" integer NOT NULL, "gateway" character varying(16) NOT NULL, "mode" character varying(8) NOT NULL, "amount" integer NOT NULL, "status" character varying(12) NOT NULL, "gatewaySessionId" character varying(100), "gatewayReference" character varying(120), "gatewayTransactionId" character varying(100), "paidAmount" integer, "paidAt" TIMESTAMP(6), "failureCode" character varying(40), "nextCheckAt" TIMESTAMP(6), "checks" integer NOT NULL DEFAULT '0', "lastCheckedAt" TIMESTAMP(6), "reviewReason" character varying(12), "reviewState" character varying(12), "reviewNote" character varying(500), "reviewedBy" character varying(120), "reviewedAt" TIMESTAMP(6), "refundReference" character varying(100), "events" jsonb NOT NULL DEFAULT '[]', "id" SERIAL NOT NULL, CONSTRAINT "PK_5117a5800ef1c5452d4949b0ed9" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_46b6039525bb41fd801b4cf7c9" ON "bd_payment_attempt" ("token") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_bdf675f4ce4447ce2424a55b95" ON "bd_payment_attempt" ("orderId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_26e1af383ecb2a67a90dfd0c19" ON "bd_payment_attempt" ("paymentId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_5ba86efb29e16cd9d0915d1a09" ON "bd_payment_attempt" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_4dd28c803fed0ad4013b96c797" ON "bd_payment_attempt" ("gatewaySessionId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_cd66c25edcc345db0523233f44" ON "bd_payment_attempt" ("gatewayReference") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_80ee3d994dc437410673d3b095" ON "bd_payment_attempt" ("nextCheckAt") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_0ceedbdbfe61515242a3d0c6ff" ON "bd_payment_attempt" ("reviewState") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_0ceedbdbfe61515242a3d0c6ff"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_80ee3d994dc437410673d3b095"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_cd66c25edcc345db0523233f44"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_4dd28c803fed0ad4013b96c797"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_5ba86efb29e16cd9d0915d1a09"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_26e1af383ecb2a67a90dfd0c19"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_bdf675f4ce4447ce2424a55b95"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_46b6039525bb41fd801b4cf7c9"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_payment_attempt"`, undefined);
   }

}
