import {MigrationInterface, QueryRunner} from "typeorm";

export class BdSalesPages1792681556051 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_sales_page" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "title" character varying(150) NOT NULL, "slug" character varying(80) NOT NULL, "template" character varying(40) NOT NULL DEFAULT '', "settings" jsonb NOT NULL, "active" boolean NOT NULL DEFAULT true, "createdBy" character varying(120) NOT NULL DEFAULT '', "id" SERIAL NOT NULL, "productId" integer, CONSTRAINT "PK_f76b16191639e8fcff8997215d3" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_99dec90e1826032619bc0c345a" ON "bd_sales_page" ("slug") `, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsSalespageid" character varying(40)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsUtmsource" character varying(150)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsUtmmedium" character varying(150)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsUtmcampaign" character varying(150)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsUtmcontent" character varying(150)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsUtmterm" character varying(150)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsFbclid" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsGclid" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsTtclid" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsReferrer" character varying(100)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsAttributedat" TIMESTAMP(6)`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_sales_page" ADD CONSTRAINT "FK_ff485281fcca52e5c80dbff5247" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE NO ACTION`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bd_sales_page" DROP CONSTRAINT "FK_ff485281fcca52e5c80dbff5247"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsAttributedat"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsReferrer"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsTtclid"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsGclid"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsFbclid"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsUtmterm"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsUtmcontent"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsUtmcampaign"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsUtmmedium"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsUtmsource"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsSalespageid"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_99dec90e1826032619bc0c345a"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_sales_page"`, undefined);
   }

}
