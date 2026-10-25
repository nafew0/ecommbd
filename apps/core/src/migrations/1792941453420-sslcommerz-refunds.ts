import {MigrationInterface, QueryRunner} from "typeorm";

export class SslcommerzRefunds1792941453420 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" ADD "riskTitle" character varying(100)`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" ADD "refundTransId" character varying(30)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" DROP COLUMN "refundTransId"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" DROP COLUMN "riskTitle"`, undefined);
   }

}
