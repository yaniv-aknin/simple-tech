; --- set up the game (runs once) ---
start:
.c bx0
  LDI A, 5          ; puck starts at x = 5
  STORE [BX], A
.c by0
  LDI A, 3          ; and y = 3
  STORE [BY], A
.c dx0
  LDI A, 1          ; moving right
  STORE [DX], A
.c dy0
  LDI A, 1          ; and down
  STORE [DY], A
.c sc0
  LDI A, 0
  STORE [SCORE], A  ; score = 0
.c px0
  LDI A, 6
  STORE [PX], A     ; paddle in the middle

; --- wait for a key press ---
wait:
.c wait
  LOAD A, [KEY]
  JZ wait           ; 0: no key yet

; --- main loop: forever ---
loop:
.c px_add
  LOAD A, [PX]
  LOAD B, [KEY]     ; 255 left, 1 right, 0 none
  ADD A, B
  STORE [PX], A     ; move the paddle
.c px_lo
  JN clampL         ; went below 0?
.c px_hi
  LDI B, 14
  SUB A, B
  JN moveBall       ; PX < 14: fine
.c px_13
  LDI A, 13         ; too far right: pull back
  STORE [PX], A
  JMP moveBall
clampL:
.c px_0
  LDI A, 0
  STORE [PX], A
moveBall:
.c bx_add
  LOAD A, [BX]
  LOAD B, [DX]
  ADD A, B
  STORE [BX], A     ; BX = BX + DX
.c by_add
  LOAD A, [BY]
  LOAD B, [DY]
  ADD A, B
  STORE [BY], A     ; BY = BY + DY
.c if_top
  JZ topHit         ; BY is 0: top wall

; --- other walls ---
checkSides:
.c if_side
  LOAD A, [BX]
  JZ sideHit        ; BX is 0: left wall
  LDI B, 15
  SUB A, B
  JZ sideHit        ; BX is 15: right wall

; --- paddle row ---
checkPaddle:
.c if_row
  LOAD A, [BY]
  LDI B, 11
  SUB A, B
  JZ paddleRow      ; BY is 11
  JMP loop
paddleRow:
.c if_pad
  LOAD A, [BX]
  LOAD B, [PX]
  SUB A, B
  JN miss           ; left of the paddle
  LDI B, 3
  SUB A, B
  JN paddleHit      ; within the paddle's 3 cells
miss:
.c goto_start
  JMP start         ; missed: game over, start again
paddleHit:
.c pad_dy
  LDI A, 0
  LOAD B, [DY]
  SUB A, B
  STORE [DY], A     ; DY = 0 - DY (bounce)
  JMP loop

; --- wall hits: bounce and score ---
topHit:
.c top_dy
  LDI A, 0
  LOAD B, [DY]
  SUB A, B
  STORE [DY], A     ; bounce
.c top_sc
  LOAD A, [SCORE]
  LDI B, 1
  ADD A, B
  STORE [SCORE], A  ; score + 1
  JMP checkSides
sideHit:
.c side_dx
  LDI A, 0
  LOAD B, [DX]
  SUB A, B
  STORE [DX], A     ; bounce
.c side_sc
  LOAD A, [SCORE]
  LDI B, 1
  ADD A, B
  STORE [SCORE], A  ; score + 1
  JMP checkPaddle
