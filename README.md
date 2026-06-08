# gujeuk_prototype

## 홈서버 배포

홈서버의 `/home/ubuntu/git/gujeuk_prototype`에서 Docker Compose로 정적 프로토타입을 실행합니다.

```bash
docker compose up -d --build
```

기본 포트는 서버 내부의 `127.0.0.1:8788`이며 루트 경로는 `/v1/`으로 이동합니다.

새 커밋을 반영할 때는 다음 스크립트를 사용합니다.

```bash
./ops/deploy.sh
```

Gujeuk 체크인 서비스 신규 프로토타입을 버전별로 관리하는 저장소입니다.

## Versions

- `v1/`: 현재까지 작업한 태블릿 수기 첫 방문 등록 프로토타입
- `v2/`: 태블릿 입력형 첫 방문 등록 프로토타입

## 실행

```bash
python3 -m http.server 5173
```

- 버전 선택 화면: `http://localhost:5173/`
- v1 프로토타입: `http://localhost:5173/v1/`
- v2 프로토타입: `http://localhost:5173/v2/`
