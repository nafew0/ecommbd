import {MigrationInterface, QueryRunner} from "typeorm";

export class BdCatalog1792571164679 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_stock_adjustment" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "productVariantId" integer NOT NULL, "change" integer NOT NULL, "stockAfter" integer NOT NULL, "reason" character varying(16) NOT NULL, "note" character varying(500) NOT NULL DEFAULT '', "staffName" character varying(120) NOT NULL DEFAULT '', "id" SERIAL NOT NULL, CONSTRAINT "PK_5e7ce3b11bbacc4bd75752025c9" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_cbec1290e4dcd5051ba1006d1e" ON "bd_stock_adjustment" ("productVariantId") `, undefined);
        await queryRunner.query(`CREATE TABLE "product_custom_fields_feedback_assets_asset" ("productId" integer NOT NULL, "assetId" integer NOT NULL, CONSTRAINT "PK_a6dcbb3188263a188f9908c8150" PRIMARY KEY ("productId", "assetId"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_ab3ce6b0b9e704240ff061892b" ON "product_custom_fields_feedback_assets_asset" ("productId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_29aeeda2f59d7fc7c29446cfcb" ON "product_custom_fields_feedback_assets_asset" ("assetId") `, undefined);
        await queryRunner.query(`ALTER TABLE "collection" ADD "customFieldsBdcategory" boolean NOT NULL DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "product_translation" ADD "customFieldsShortdescription" text`, undefined);
        await queryRunner.query(`ALTER TABLE "product_translation" ADD "customFieldsSeotitle" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "product_translation" ADD "customFieldsSeodescription" text`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsFeatured" boolean NOT NULL DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsIsnew" boolean NOT NULL DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsYoutubeurl" character varying(500)`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsCategoryid" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" ADD "customFieldsOldprice" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" ADD "customFieldsIsdefault" boolean NOT NULL DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD CONSTRAINT "FK_77975723382d45b1466740d1813" FOREIGN KEY ("customFieldsCategoryid") REFERENCES "collection"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "product_custom_fields_feedback_assets_asset" ADD CONSTRAINT "FK_ab3ce6b0b9e704240ff061892b4" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
        await queryRunner.query(`ALTER TABLE "product_custom_fields_feedback_assets_asset" ADD CONSTRAINT "FK_29aeeda2f59d7fc7c29446cfcb1" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE CASCADE ON UPDATE CASCADE`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "product_custom_fields_feedback_assets_asset" DROP CONSTRAINT "FK_29aeeda2f59d7fc7c29446cfcb1"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_custom_fields_feedback_assets_asset" DROP CONSTRAINT "FK_ab3ce6b0b9e704240ff061892b4"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP CONSTRAINT "FK_77975723382d45b1466740d1813"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" DROP COLUMN "customFieldsIsdefault"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" DROP COLUMN "customFieldsOldprice"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsCategoryid"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsYoutubeurl"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsIsnew"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsFeatured"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_translation" DROP COLUMN "customFieldsSeodescription"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_translation" DROP COLUMN "customFieldsSeotitle"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_translation" DROP COLUMN "customFieldsShortdescription"`, undefined);
        await queryRunner.query(`ALTER TABLE "collection" DROP COLUMN "customFieldsBdcategory"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_29aeeda2f59d7fc7c29446cfcb"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_ab3ce6b0b9e704240ff061892b"`, undefined);
        await queryRunner.query(`DROP TABLE "product_custom_fields_feedback_assets_asset"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_cbec1290e4dcd5051ba1006d1e"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_stock_adjustment"`, undefined);
   }

}
