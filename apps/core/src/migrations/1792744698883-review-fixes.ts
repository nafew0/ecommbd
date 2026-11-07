import {MigrationInterface, QueryRunner} from "typeorm";

export class ReviewFixes1792744698883 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "woo_redirect" ADD "manual" boolean NOT NULL DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "woo_run" ADD "startedBy" character varying`, undefined);
        await queryRunner.query(`ALTER TABLE "cache_stock_state" ADD "level" character varying(16)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "cache_stock_state" DROP COLUMN "level"`, undefined);
        await queryRunner.query(`ALTER TABLE "woo_run" DROP COLUMN "startedBy"`, undefined);
        await queryRunner.query(`ALTER TABLE "woo_redirect" DROP COLUMN "manual"`, undefined);
   }

}
