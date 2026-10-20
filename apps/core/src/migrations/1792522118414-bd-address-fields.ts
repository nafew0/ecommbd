import {MigrationInterface, QueryRunner} from "typeorm";

export class BdAddressFields1792522118414 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "address" ADD "customFieldsDistrictid" character varying(16)`, undefined);
        await queryRunner.query(`ALTER TABLE "address" ADD "customFieldsThanaid" character varying(16)`, undefined);
        await queryRunner.query(`ALTER TABLE "address" ADD "customFieldsArea" character varying(120)`, undefined);
        await queryRunner.query(`ALTER TABLE "address" ADD "customFieldsLandmark" character varying(120)`, undefined);
        await queryRunner.query(`ALTER TABLE "address" ADD "customFieldsAlternatephone" character varying(20)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "address" DROP COLUMN "customFieldsAlternatephone"`, undefined);
        await queryRunner.query(`ALTER TABLE "address" DROP COLUMN "customFieldsLandmark"`, undefined);
        await queryRunner.query(`ALTER TABLE "address" DROP COLUMN "customFieldsArea"`, undefined);
        await queryRunner.query(`ALTER TABLE "address" DROP COLUMN "customFieldsThanaid"`, undefined);
        await queryRunner.query(`ALTER TABLE "address" DROP COLUMN "customFieldsDistrictid"`, undefined);
   }

}
