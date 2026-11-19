import {MigrationInterface, QueryRunner} from "typeorm";

export class PageBuilderLibrary1795125803445 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_contact_message" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "name" character varying(80) NOT NULL, "phone" character varying(20) NOT NULL, "message" text NOT NULL DEFAULT '', "page" character varying(200) NOT NULL DEFAULT '', "handled" boolean NOT NULL DEFAULT false, "id" SERIAL NOT NULL, CONSTRAINT "PK_cc7f4d874fb6511abfa6c5992e4" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_a48132b46be4ba283a775c81f3" ON "bd_contact_message" ("phone") `, undefined);
        await queryRunner.query(`ALTER TABLE "bd_saved_section" ADD "kind" character varying(12) NOT NULL DEFAULT 'section'`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_saved_section" ADD "document" jsonb`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_saved_section" ADD "favourite" boolean NOT NULL DEFAULT false`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bd_saved_section" DROP COLUMN "favourite"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_saved_section" DROP COLUMN "document"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_saved_section" DROP COLUMN "kind"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_a48132b46be4ba283a775c81f3"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_contact_message"`, undefined);
   }

}
