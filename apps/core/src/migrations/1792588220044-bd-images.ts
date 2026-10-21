import {MigrationInterface, QueryRunner} from "typeorm";

export class BdImages1792588220044 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_image" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "hash" character varying(64) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "failure" character varying(200), "width" integer NOT NULL DEFAULT '0', "height" integer NOT NULL DEFAULT '0', "animated" boolean NOT NULL DEFAULT false, "variants" text, "bytes" integer NOT NULL DEFAULT '0', "dominantColor" character varying(7), "placeholder" text, "orphanedAt" TIMESTAMP, "id" SERIAL NOT NULL, CONSTRAINT "PK_eba004055c80c6aea538d6b9874" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f6f94e6d1f21cf4bf1c6029b9d" ON "bd_image" ("hash") `, undefined);
        await queryRunner.query(`ALTER TABLE "asset_translation" ADD "customFields__fix_relational_custom_fields__" boolean`, undefined);
        await queryRunner.query(`COMMENT ON COLUMN "asset_translation"."customFields__fix_relational_custom_fields__" IS 'A work-around needed when only relational custom fields are defined on an entity'`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" ADD "customFields__fix_relational_custom_fields__" boolean`, undefined);
        await queryRunner.query(`COMMENT ON COLUMN "asset"."customFields__fix_relational_custom_fields__" IS 'A work-around needed when only relational custom fields are defined on an entity'`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" ADD "customFieldsBdimageid" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" ADD CONSTRAINT "FK_fb90196689bff1db85f24877d6d" FOREIGN KEY ("customFieldsBdimageid") REFERENCES "bd_image"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "FK_fb90196689bff1db85f24877d6d"`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "customFieldsBdimageid"`, undefined);
        await queryRunner.query(`COMMENT ON COLUMN "asset"."customFields__fix_relational_custom_fields__" IS 'A work-around needed when only relational custom fields are defined on an entity'`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "customFields__fix_relational_custom_fields__"`, undefined);
        await queryRunner.query(`COMMENT ON COLUMN "asset_translation"."customFields__fix_relational_custom_fields__" IS 'A work-around needed when only relational custom fields are defined on an entity'`, undefined);
        await queryRunner.query(`ALTER TABLE "asset_translation" DROP COLUMN "customFields__fix_relational_custom_fields__"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_f6f94e6d1f21cf4bf1c6029b9d"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_image"`, undefined);
   }

}
