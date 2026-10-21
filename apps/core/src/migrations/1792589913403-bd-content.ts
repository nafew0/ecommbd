import {MigrationInterface, QueryRunner} from "typeorm";

export class BdContent1792589913403 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_page" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "enabled" boolean NOT NULL DEFAULT true, "id" SERIAL NOT NULL, CONSTRAINT "PK_320f6ca8ce8b2dfa52b3e7b13e8" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE TABLE "bd_page_translation" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "languageCode" character varying(8) NOT NULL, "title" character varying(255) NOT NULL, "slug" character varying(255) NOT NULL, "body" text NOT NULL, "seoTitle" character varying(255) NOT NULL DEFAULT '', "seoDescription" character varying(500) NOT NULL DEFAULT '', "id" SERIAL NOT NULL, "pageId" integer NOT NULL, CONSTRAINT "PK_371d1475248ac38621d50a5e8bb" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9542e19730dc71cf20600c8d0e" ON "bd_page_translation" ("languageCode", "slug") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_slug" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "entityType" character varying(16) NOT NULL, "entityId" character varying(40) NOT NULL, "languageCode" character varying(8) NOT NULL, "slug" character varying(255) NOT NULL, "current" boolean NOT NULL DEFAULT true, "deletedAt" TIMESTAMP, "id" SERIAL NOT NULL, CONSTRAINT "PK_6127311ad12da249547a4119a2c" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_bc9fae0eab7119dcd425f56914" ON "bd_slug" ("entityType", "entityId") `, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4b1fac27b7fb7f362cc96ea6e0" ON "bd_slug" ("entityType", "languageCode", "slug") `, undefined);
        await queryRunner.query(`ALTER TABLE "collection_translation" ADD "customFieldsSeotitle" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "collection_translation" ADD "customFieldsSeodescription" text`, undefined);
        await queryRunner.query(`ALTER TABLE "product_translation" ADD "customFieldsSeotitle" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "product_translation" ADD "customFieldsSeodescription" text`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_page_translation" ADD CONSTRAINT "FK_ba962e3305aa99dc6b33403892c" FOREIGN KEY ("pageId") REFERENCES "bd_page"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bd_page_translation" DROP CONSTRAINT "FK_ba962e3305aa99dc6b33403892c"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_translation" DROP COLUMN "customFieldsSeodescription"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_translation" DROP COLUMN "customFieldsSeotitle"`, undefined);
        await queryRunner.query(`ALTER TABLE "collection_translation" DROP COLUMN "customFieldsSeodescription"`, undefined);
        await queryRunner.query(`ALTER TABLE "collection_translation" DROP COLUMN "customFieldsSeotitle"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_4b1fac27b7fb7f362cc96ea6e0"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_bc9fae0eab7119dcd425f56914"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_slug"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_9542e19730dc71cf20600c8d0e"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_page_translation"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_page"`, undefined);
   }

}
