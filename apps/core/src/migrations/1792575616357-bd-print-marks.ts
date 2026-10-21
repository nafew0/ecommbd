import {MigrationInterface, QueryRunner} from "typeorm";

export class BdPrintMarks1792575616357 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsInvoiceprintedat" TIMESTAMP(6)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsSlipprintedat" TIMESTAMP(6)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsStickerprintedat" TIMESTAMP(6)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsStickerprintedat"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsSlipprintedat"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsInvoiceprintedat"`, undefined);
   }

}
