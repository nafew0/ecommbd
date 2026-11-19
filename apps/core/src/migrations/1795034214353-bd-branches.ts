import {MigrationInterface, QueryRunner} from "typeorm";

export class BdBranches1795034214353 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_stock_transfer" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "number" character varying(40) NOT NULL, "fromLocationId" integer NOT NULL, "toLocationId" integer NOT NULL, "status" character varying(16) NOT NULL, "note" character varying(500) NOT NULL DEFAULT '', "sentAt" TIMESTAMP(6) NOT NULL, "id" SERIAL NOT NULL, CONSTRAINT "PK_00213b80821fa8f68f9283c9eb7" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6f15ade024bc696e3613df51bb" ON "bd_stock_transfer" ("number") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_02ad37a45580b425872affcd1d" ON "bd_stock_transfer" ("fromLocationId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_abe3097e5d696b66fda7484e50" ON "bd_stock_transfer" ("toLocationId") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_stock_transfer_line" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "transferId" integer NOT NULL, "productVariantId" integer NOT NULL, "quantity" integer NOT NULL, "received" integer NOT NULL DEFAULT '0', "id" SERIAL NOT NULL, CONSTRAINT "PK_7bab596c6e51700943d3c373566" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_bd8c050957ac2a00d6f7e87c4e" ON "bd_stock_transfer_line" ("transferId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_ceae06aa1763dac487a4373cef" ON "bd_stock_transfer_line" ("productVariantId") `, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsShippingbranchid" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsTransferneeded" boolean DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsReturnstockrestored" boolean NOT NULL DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "stock_location" ADD "customFieldsPhone" character varying(20)`, undefined);
        await queryRunner.query(`ALTER TABLE "stock_location" ADD "customFieldsDistrictid" character varying(16) DEFAULT ''`, undefined);
        await queryRunner.query(`ALTER TABLE "stock_location" ADD "customFieldsThanaid" character varying(16) DEFAULT ''`, undefined);
        await queryRunner.query(`ALTER TABLE "stock_location" ADD "customFieldsAddressline" character varying(200) DEFAULT ''`, undefined);
        await queryRunner.query(`ALTER TABLE "stock_location" ADD "customFieldsNote" text DEFAULT ''`, undefined);
        await queryRunner.query(`ALTER TABLE "stock_location" ADD "customFieldsSellsonline" boolean DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_courier_booking" ADD "pickupAddress" character varying(500)`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_courier_booking" ADD "pickupBranchId" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_purchase" ADD "stockLocationId" integer`, undefined);
        await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS "bd_stock_transfer_number_seq" START WITH 1001`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP SEQUENCE IF EXISTS "bd_stock_transfer_number_seq"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_purchase" DROP COLUMN "stockLocationId"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_courier_booking" DROP COLUMN "pickupBranchId"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_courier_booking" DROP COLUMN "pickupAddress"`, undefined);
        await queryRunner.query(`ALTER TABLE "stock_location" DROP COLUMN "customFieldsSellsonline"`, undefined);
        await queryRunner.query(`ALTER TABLE "stock_location" DROP COLUMN "customFieldsNote"`, undefined);
        await queryRunner.query(`ALTER TABLE "stock_location" DROP COLUMN "customFieldsAddressline"`, undefined);
        await queryRunner.query(`ALTER TABLE "stock_location" DROP COLUMN "customFieldsThanaid"`, undefined);
        await queryRunner.query(`ALTER TABLE "stock_location" DROP COLUMN "customFieldsDistrictid"`, undefined);
        await queryRunner.query(`ALTER TABLE "stock_location" DROP COLUMN "customFieldsPhone"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsReturnstockrestored"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsTransferneeded"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsShippingbranchid"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_ceae06aa1763dac487a4373cef"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_bd8c050957ac2a00d6f7e87c4e"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_stock_transfer_line"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_abe3097e5d696b66fda7484e50"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_02ad37a45580b425872affcd1d"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_6f15ade024bc696e3613df51bb"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_stock_transfer"`, undefined);
   }

}
