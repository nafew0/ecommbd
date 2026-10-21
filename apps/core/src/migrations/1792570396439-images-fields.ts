import {MigrationInterface, QueryRunner} from "typeorm";

export class ImagesFields1792570396439 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "asset" ADD "customFieldsContenthash" character varying(64)`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" ADD "customFieldsImagewidths" character varying(64)`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" ADD "customFieldsDominantcolor" character varying(7)`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" ADD "customFieldsPlaceholder" text`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" ADD "customFieldsImagestatus" character varying(16) NOT NULL DEFAULT 'pending'`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" ADD "customFieldsVariantbytes" integer NOT NULL DEFAULT '0'`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_6b8dcac1129e80c0cc5aa93231" ON "asset" ("customFieldsContenthash") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_6b8dcac1129e80c0cc5aa93231"`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "customFieldsVariantbytes"`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "customFieldsImagestatus"`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "customFieldsPlaceholder"`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "customFieldsDominantcolor"`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "customFieldsImagewidths"`, undefined);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "customFieldsContenthash"`, undefined);
   }

}
