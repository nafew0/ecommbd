import {MigrationInterface, QueryRunner} from "typeorm";

export class AddAccountsExpenses1795026265664 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_account" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "kind" character varying(16) NOT NULL, "name" character varying(80) NOT NULL, "openingBalance" integer NOT NULL DEFAULT '0', "id" SERIAL NOT NULL, CONSTRAINT "PK_3ae3f3a6f030cdba8f5a21c3402" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "bd_expense_head" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "code" character varying(40) NOT NULL, "nameBn" character varying(80) NOT NULL, "nameEn" character varying(80) NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "PK_aa5a3dd54b2cdaafa4f589b23c4" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a8cb0cc3f108bf211a983eabbf" ON "bd_expense_head" ("code") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_expense" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "day" character varying(10) NOT NULL, "headId" integer NOT NULL, "amount" integer NOT NULL, "accountId" integer NOT NULL, "note" character varying(1000) NOT NULL DEFAULT '', "receiptAssetId" integer, "id" SERIAL NOT NULL, CONSTRAINT "PK_5a7eb3e5b32a469d6c0049f5630" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_8961612c6ba9990ea1778d6b83" ON "bd_expense" ("headId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_ba96e6996fb41e526b183121a4" ON "bd_expense" ("accountId") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_transaction" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "accountId" integer NOT NULL, "direction" character varying(8) NOT NULL, "amount" integer NOT NULL, "day" character varying(10) NOT NULL, "source" character varying(16) NOT NULL, "sourceId" character varying(40), "note" character varying(500) NOT NULL DEFAULT '', "transferId" character varying(40), "idempotencyKey" character varying(80), "id" SERIAL NOT NULL, CONSTRAINT "PK_6f2534a688724028c85ffbc0ae2" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_5f70867266f13408c4b3cb9a79" ON "bd_transaction" ("accountId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_c67f2691f2f46a570efa9d1ad3" ON "bd_transaction" ("day") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9c036bb80780dcf82a4570c232" ON "bd_transaction" ("idempotencyKey") `, undefined);
        await queryRunner.query(`ALTER TABLE "bd_supplier_payment" ADD "accountId" integer`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bd_supplier_payment" DROP COLUMN "accountId"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9c036bb80780dcf82a4570c232"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_c67f2691f2f46a570efa9d1ad3"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_5f70867266f13408c4b3cb9a79"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_transaction"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_ba96e6996fb41e526b183121a4"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_8961612c6ba9990ea1778d6b83"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_expense"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_a8cb0cc3f108bf211a983eabbf"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_expense_head"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_account"`, undefined);
   }

}
