import {MigrationInterface, QueryRunner} from "typeorm";

export class AddPurchasesAndSuppliers1794774551047 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_supplier" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying(150) NOT NULL, "phone" character varying(20), "address" character varying(500) NOT NULL DEFAULT '', "note" character varying(1000) NOT NULL DEFAULT '', "id" SERIAL NOT NULL, CONSTRAINT "PK_daf95503fbd52000d8a49ea6846" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "bd_purchase" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "supplierId" integer NOT NULL, "number" character varying(40) NOT NULL, "status" character varying(16) NOT NULL, "purchasedOn" character varying(10) NOT NULL, "note" character varying(1000) NOT NULL DEFAULT '', "receiveNote" character varying(500) NOT NULL DEFAULT '', "delivery" integer NOT NULL DEFAULT '0', "otherCharge" integer NOT NULL DEFAULT '0', "discount" integer NOT NULL DEFAULT '0', "paid" integer NOT NULL DEFAULT '0', "billAssetId" integer, "id" SERIAL NOT NULL, CONSTRAINT "PK_20080d5eb750fb6402d7ec16c88" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_3902bf7e6e584ec85d57845057" ON "bd_purchase" ("supplierId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_bf603b8045bb24802703edbaf9" ON "bd_purchase" ("number") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_purchase_line" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "purchaseId" integer NOT NULL, "productVariantId" integer NOT NULL, "quantity" integer NOT NULL, "received" integer NOT NULL DEFAULT '0', "returned" integer NOT NULL DEFAULT '0', "unitCost" integer NOT NULL, "priorUnitCost" integer, "priorKnown" boolean NOT NULL DEFAULT false, "id" SERIAL NOT NULL, CONSTRAINT "PK_ef29d2f6588432077d3aba00ab9" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b87293ce8b69de93a7ec9bb69d" ON "bd_purchase_line" ("purchaseId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_038a323093293f5953594b827c" ON "bd_purchase_line" ("productVariantId") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_purchase_return" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "purchaseId" integer NOT NULL, "supplierId" integer NOT NULL, "number" character varying(40) NOT NULL, "returnedOn" character varying(10) NOT NULL, "note" character varying(500) NOT NULL DEFAULT '', "id" SERIAL NOT NULL, CONSTRAINT "PK_aca8e89cc6f7e3bdaff58338bdd" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_296d2a69df2ff5fb62c54c239a" ON "bd_purchase_return" ("purchaseId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_7312cca06c5c54d90f176566c9" ON "bd_purchase_return" ("supplierId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9745f3f0cfe924cb6f2f117e91" ON "bd_purchase_return" ("number") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_purchase_return_line" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "returnId" integer NOT NULL, "purchaseLineId" integer NOT NULL, "quantity" integer NOT NULL, "unitCost" integer NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "PK_daa0c1f56f8a14330eca3104912" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_095aff22e55eff1c52e071c06e" ON "bd_purchase_return_line" ("returnId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_fcbc8a333340cb5c5231116521" ON "bd_purchase_return_line" ("purchaseLineId") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_supplier_payment" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "supplierId" integer NOT NULL, "amount" integer NOT NULL, "paidOn" character varying(10) NOT NULL, "note" character varying(500) NOT NULL DEFAULT '', "id" SERIAL NOT NULL, CONSTRAINT "PK_2e3cece30e517d800300e14ed2e" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_b8da91c3cf9f37c70ccb9aea1b" ON "bd_supplier_payment" ("supplierId") `, undefined);
        await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS "bd_purchase_number_seq" START WITH 1001`, undefined);
        await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS "bd_purchase_return_number_seq" START WITH 1001`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP SEQUENCE IF EXISTS "bd_purchase_return_number_seq"`, undefined);
        await queryRunner.query(`DROP SEQUENCE IF EXISTS "bd_purchase_number_seq"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b8da91c3cf9f37c70ccb9aea1b"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_supplier_payment"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_fcbc8a333340cb5c5231116521"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_095aff22e55eff1c52e071c06e"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_purchase_return_line"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9745f3f0cfe924cb6f2f117e91"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_7312cca06c5c54d90f176566c9"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_296d2a69df2ff5fb62c54c239a"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_purchase_return"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_038a323093293f5953594b827c"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_b87293ce8b69de93a7ec9bb69d"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_purchase_line"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_bf603b8045bb24802703edbaf9"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_3902bf7e6e584ec85d57845057"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_purchase"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_supplier"`, undefined);
   }

}
