uint8_t KEY, PX, BX, BY, DX, DY, SCORE;  // RAM 0xF0-F6

void main(void) {
start:
    BX = 5;                         //@bx0
    BY = 3;                         //@by0
    DX = 1;                         //@dx0
    DY = 1;                         //@dy0
    SCORE = 0;                      //@sc0
    PX = 6;                         //@px0

    for (;;) {
        PX = PX + KEY;              //@px_add
        if (PX >= 128)              //@px_lo
            PX = 0;                 //@px_0
        else if (PX >= 14)          //@px_hi
            PX = 13;                //@px_13

        BX = BX + DX;               //@bx_add
        BY = BY + DY;               //@by_add

        if (BY == 0) {              //@if_top
            DY = 0 - DY;            //@top_dy
            SCORE = SCORE + 1;      //@top_sc
        }

        if (BX == 0 || BX == 15) {  //@if_side
            DX = 0 - DX;            //@side_dx
            SCORE = SCORE + 1;      //@side_sc
        }

        if (BY == 11) {             //@if_row
            if (BX >= PX && BX < PX + 3)  //@if_pad
                DY = 0 - DY;        //@pad_dy
            else
                goto start;         //@goto_start
        }
    }
}
