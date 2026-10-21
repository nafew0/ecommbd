import {MigrationInterface, QueryRunner} from "typeorm";

export class BdOrderWorkflow1792532743108 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsOrdernumber" character varying(32)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD CONSTRAINT "UQ_c1b82ce862887c615b771ea39c7" UNIQUE ("customFieldsOrdernumber")`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsImported" boolean NOT NULL DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsCancelreason" character varying(32)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsCancelnote" character varying(500)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsConfirmqueueat" TIMESTAMP(6)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsCallattempts" integer NOT NULL DEFAULT '0'`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsLastcallat" TIMESTAMP(6)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsClaimedbyuserid" character varying(40)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsClaimedbyname" character varying(120)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsClaimeduntil" TIMESTAMP(6)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsPossibleduplicateof" character varying(32)`, undefined);
        await queryRunner.query(`ALTER TABLE "order_line" ADD "customFieldsReturnedquantity" integer NOT NULL DEFAULT '0'`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_f084dcaeff12b719845491f133" ON "order" ("customFieldsConfirmqueueat") `, undefined);
        // Written by hand: order numbers (TypeORM doesn't manage standalone sequences, and leaves them alone).
        await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS "bd_order_number_seq" START WITH 1001`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP SEQUENCE IF EXISTS "bd_order_number_seq"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_f084dcaeff12b719845491f133"`, undefined);
        await queryRunner.query(`ALTER TABLE "order_line" DROP COLUMN "customFieldsReturnedquantity"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsPossibleduplicateof"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsClaimeduntil"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsClaimedbyname"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsClaimedbyuserid"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsLastcallat"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsCallattempts"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsConfirmqueueat"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsCancelnote"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsCancelreason"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsImported"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP CONSTRAINT "UQ_c1b82ce862887c615b771ea39c7"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsOrdernumber"`, undefined);
   }

}
