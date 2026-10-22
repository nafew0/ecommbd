import {MigrationInterface, QueryRunner} from "typeorm";

export class BdSections1792632784159 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_page_layout" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "type" character varying(16) NOT NULL, "key" character varying(60) NOT NULL, "draft" jsonb NOT NULL, "draftRevision" integer NOT NULL DEFAULT '0', "draftSavedAt" TIMESTAMP, "draftSavedBy" character varying(120) NOT NULL DEFAULT '', "published" jsonb, "publishedVersion" integer NOT NULL DEFAULT '0', "publishedAt" TIMESTAMP, "publishedBy" character varying(120) NOT NULL DEFAULT '', "id" SERIAL NOT NULL, "pageId" integer, CONSTRAINT "PK_fc5d7e6dd6c62cc3a1251df4fe0" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0b075270dec0f6230ba0cf11b0" ON "bd_page_layout" ("key") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_page_layout_version" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "version" integer NOT NULL, "document" jsonb NOT NULL, "publishedAt" TIMESTAMP NOT NULL, "publishedBy" character varying(120) NOT NULL DEFAULT '', "id" SERIAL NOT NULL, "layoutId" integer NOT NULL, CONSTRAINT "PK_3afa70d666d4cfc688438303476" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a841f5bc0b418b8af491fc0f71" ON "bd_page_layout_version" ("layoutId", "version") `, undefined);
        await queryRunner.query(`CREATE TABLE "bd_saved_section" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying(80) NOT NULL, "section" jsonb NOT NULL, "createdBy" character varying(120) NOT NULL DEFAULT '', "id" SERIAL NOT NULL, CONSTRAINT "PK_848293b06623b6908930aedbb1b" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_page_layout" ADD CONSTRAINT "FK_097120844b406aca271f40a953f" FOREIGN KEY ("pageId") REFERENCES "bd_page"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_page_layout_version" ADD CONSTRAINT "FK_50f5d27efb96c6b68553f6123ce" FOREIGN KEY ("layoutId") REFERENCES "bd_page_layout"("id") ON DELETE CASCADE ON UPDATE NO ACTION`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bd_page_layout_version" DROP CONSTRAINT "FK_50f5d27efb96c6b68553f6123ce"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_page_layout" DROP CONSTRAINT "FK_097120844b406aca271f40a953f"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_saved_section"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_a841f5bc0b418b8af491fc0f71"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_page_layout_version"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_0b075270dec0f6230ba0cf11b0"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_page_layout"`, undefined);
   }

}
