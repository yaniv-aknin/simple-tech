; --- set up the game (runs once) ---
start:
  LDI A, 5          ; puck starts at x = 5
  STORE [BX], A
  LDI A, 3          ; and y = 3
  STORE [BY], A
  LDI A, 1          ; moving right
  STORE [DX], A
  LDI A, 1          ; and down
  STORE [DY], A
  LDI A, 0
  STORE [SCORE], A  ; score = 0
  LDI A, 6
  STORE [PX], A     ; paddle in the middle

; --- main loop: forever ---
loop:
  LOAD A, [PX]
  LOAD B, [KEY]     ; 255 left, 1 right, 0 none
  ADD A, B
  STORE [PX], A     ; move the paddle
  JN clampL         ; went below 0?
  LDI B, 14
  SUB A, B
  JN moveBall       ; PX < 14: fine
  LDI A, 13         ; too far right: pull back
  STORE [PX], A
  JMP moveBall
clampL:
  LDI A, 0
  STORE [PX], A
moveBall:
  LOAD A, [BX]
  LOAD B, [DX]
  ADD A, B
  STORE [BX], A     ; BX = BX + DX
  LOAD A, [BY]
  LOAD B, [DY]
  ADD A, B
  STORE [BY], A     ; BY = BY + DY
  JZ topHit         ; BY is 0: top wall

; --- other walls ---
checkSides:
  LOAD A, [BX]
  JZ sideHit        ; BX is 0: left wall
  LDI B, 15
  SUB A, B
  JZ sideHit        ; BX is 15: right wall

; --- paddle row ---
checkPaddle:
  LOAD A, [BY]
  LDI B, 11
  SUB A, B
  JZ paddleRow      ; BY is 11
  JMP loop
paddleRow:
  LOAD A, [BX]
  LOAD B, [PX]
  SUB A, B
  JN miss           ; left of the paddle
  LDI B, 3
  SUB A, B
  JN paddleHit      ; within the paddle's 3 cells
miss:
  JMP start         ; missed: game over, start again
paddleHit:
  LDI A, 0
  LOAD B, [DY]
  SUB A, B
  STORE [DY], A     ; DY = 0 - DY (bounce)
  JMP loop

; --- wall hits: bounce and score ---
topHit:
  LDI A, 0
  LOAD B, [DY]
  SUB A, B
  STORE [DY], A     ; bounce
  LOAD A, [SCORE]
  LDI B, 1
  ADD A, B
  STORE [SCORE], A  ; score + 1
  JMP checkSides
sideHit:
  LDI A, 0
  LOAD B, [DX]
  SUB A, B
  STORE [DX], A     ; bounce
  LOAD A, [SCORE]
  LDI B, 1
  ADD A, B
  STORE [SCORE], A  ; score + 1
  JMP checkPaddle
