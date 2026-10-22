import {MigrationInterface, QueryRunner} from "typeorm";

export class BdSearch1792610358264 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_search_miss" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "term" character varying(100) NOT NULL, "day" date NOT NULL, "count" integer NOT NULL DEFAULT '1', "id" SERIAL NOT NULL, "channelId" integer NOT NULL, CONSTRAINT "UQ_bd_search_miss_term_day" UNIQUE ("channelId", "term", "day"), CONSTRAINT "PK_67224c39c11325e3341f4a5e46c" PRIMARY KEY ("id"))`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP TABLE "bd_search_miss"`, undefined);
   }

}
